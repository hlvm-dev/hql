# HLVM Memory System — Final Design

> Inspired by OpenClaw (~80% same architecture). Adapted for Deno runtime, global scope, no plugins.

---

## Vision

Every conversation is a continuation, not a cold start.
The user never explains twice. They just type and chat.
Every context is remembered.

**Before:** Smart but amnesiac — forgets everything between conversations.
**After:** Smart and personal — remembers everything, forever, automatically.

---

## Design Decisions (Settled)

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Architecture | ~80% OpenClaw | Proven design. Don't reinvent. |
| Identity file | MEMORY.md | Always loaded. User's profile. Same name as OpenClaw. |
| Journal format | Daily markdown files | One per day. LLM-summarized. Append-only. |
| Why summarize, not raw | Compact search results, fewer tokens | Raw is lossless but noisy. 5K raw tokens vs 20 summarized. |
| Database | SQLite + FTS5 | Universal, battle-tested, proper search. Not Deno KV (platform lock-in). |
| Search | BM25 via FTS5 + temporal decay | Keyword search with recency boost. Vector search deferred to later. |
| Scope | Global | No per-project boundaries. HLVM is always-on, like Siri. |
| Extraction model | Same model as conversation | No separate model. User picks one model, it handles everything. |
| Plugins | None | One built-in system. KISS. |
| When LLM writes to memory | During conversation (tool call) | LLM decides when to call memory_write. Like any other tool. |
| Safety net | Pre-compaction flush | Before context window shrinks, prompt LLM to save unsaved facts. |
| MEMORY.md growth | AI proposes, user approves | AI notices patterns, suggests additions. User can also edit directly. |

---

## File Layout

```
~/.hlvm/memory/
│
├── MEMORY.md                    # Always loaded. User identity. ~2-3K tokens max.
│
├── journal/
│   ├── 2026-02-21.md            # Today (auto-loaded at startup)
│   ├── 2026-02-20.md            # Yesterday (auto-loaded at startup)
│   ├── 2026-02-19.md            # Older (searchable via FTS5, not auto-loaded)
│   └── ...
│
└── index.sqlite                 # FTS5 search index over all journal files
```

---

## MEMORY.md Format

Structured sections. Human-readable. User-editable. AI-growable.

```markdown
# Preferences
- Runtime: Deno
- Style: tabs, no semicolons
- Testing: always run before commit
- Commits: conventional commit format

# Decisions
- [2026-02-20] Auth: JWT with refresh tokens (stateless API)
- [2026-02-15] DB: SQLite local, Postgres production

# Remember
- Staging password is in 1Password vault "DevOps"
- Deploy window: Tuesday through Thursday only
- Alice (auth team) prefers async communication

# Projects
- myapp: ~/projects/myapp (React + Deno backend)
- hql: ~/dev/hql (language compiler)

# Error Patterns
- CORS: check Access-Control-Allow-Origin header
- Deno test failures: usually import map in deno.json
```

**Written by:** LLM via `memory_write` tool + user edits directly.
**Loaded:** Every conversation, injected into system prompt.
**Size cap:** ~3K tokens. If exceeded, LLM consolidates (merge/prune stale entries).

---

## Journal Format

One file per day. Timestamped sections. LLM-summarized, not raw transcripts.

```markdown
## 09:15
Resumed auth module refactor in ~/projects/myapp.
Fixed JWT refresh: mock returned expires_in instead of expires_at
(unix timestamp). 3/4 tests passing.

## 14:32
CORS bug in /api/users.ts — added Access-Control-Allow-Origin header.
Deployed to staging.

## 17:00
Groceries: oat milk, eggs, hot sauce from Asian market on 5th.
```

**Written by:** LLM via `memory_write` during conversation.
**Auto-loaded:** Today + yesterday at startup.
**Older files:** Searchable via `memory_search` tool, not auto-loaded.

---

## SQLite Index

```sql
-- Chunks from journal files, indexed for FTS5 search
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  file TEXT,            -- "journal/2026-02-21.md"
  line_start INTEGER,
  line_end INTEGER,
  text TEXT,            -- chunk content (~400 tokens)
  date TEXT,            -- "2026-02-21" (for temporal decay)
  created_at INTEGER    -- unix timestamp
);

-- FTS5 virtual table for BM25 full-text search
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  content=chunks,
  content_rowid=id
);

-- File freshness tracking (avoid re-indexing unchanged files)
CREATE TABLE meta (
  file TEXT PRIMARY KEY,
  mtime INTEGER,
  hash TEXT
);
```

**Updated:** After every `memory_write` call (reindex the changed file).
**Chunking:** ~400-token chunks with 80-token overlap.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        HLVM Agent Runtime                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                     System Prompt                        │    │
│  │                                                          │    │
│  │  [Base instructions]                                     │    │
│  │  [Tool schemas: ..., memory_search, memory_write]        │    │
│  │  [Environment]                                           │    │
│  │                                                          │    │
│  │  # Your Memory                                           │    │
│  │  [MEMORY.md content]                                     │    │
│  │                                                          │    │
│  │  # Recent Context                                        │    │
│  │  [Today's journal]                                       │    │
│  │  [Yesterday's journal]                                   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                     Tool Registry                        │    │
│  │                                                          │    │
│  │  Existing: read_file, write_file, shell, git, browser... │    │
│  │  New:      memory_search, memory_write                   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                     Orchestrator                         │    │
│  │                                                          │    │
│  │  Existing: token counting, compaction, tool dispatch     │    │
│  │  New:      pre-compaction flush (safety net)             │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                 Memory Module (NEW)                       │    │
│  │                                                          │    │
│  │  src/hlvm/memory/                                        │    │
│  │  ├── mod.ts        barrel export                         │    │
│  │  ├── manager.ts    load, inject, reindex orchestration   │    │
│  │  ├── store.ts      read/write MEMORY.md + journal files  │    │
│  │  ├── search.ts     SQLite FTS5 queries + temporal decay  │    │
│  │  ├── indexer.ts    chunk files → insert into FTS5        │    │
│  │  └── tools.ts      memory_search + memory_write defs     │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### IN: How Memory Gets Written

```
PATH 1: LLM writes during conversation (primary)
═══════════════════════════════════════════════════

  System prompt tells LLM:
    "When the user makes a decision, expresses a preference,
     solves a problem, or asks you to remember something —
     write it to memory using memory_write."

  User: "let's use Postgres instead of SQLite"
    → LLM calls memory_write(content: "...", target: "journal")

  User: "remember: deploy window is Tue-Thu only"
    → LLM calls memory_write(content: "...", target: "memory")

  The LLM decides when to write. Same as deciding when to
  read a file or run a shell command. Just another tool.


PATH 2: Pre-compaction flush (safety net)
═══════════════════════════════════════════════════

  Context window ~80% full
    → Orchestrator injects system message:
      "Context nearing limit. If there are important facts,
       decisions, or outcomes not yet saved, write them now."
    → LLM calls memory_write if anything unsaved
    → Normal compaction proceeds
    → One flush per compaction cycle

  This catches anything the LLM forgot to write in Path 1.


PATH 3: AI proposes MEMORY.md additions (growth)
═══════════════════════════════════════════════════

  After multiple conversations where user always chooses Deno:
    → LLM: "I noticed you always use Deno. Add to your memory?"
    → User: "yes"
    → LLM calls memory_write(content: "Runtime: always Deno", target: "memory")
```

### OUT: How Memory Gets Read

```
MOMENT 1: System prompt injection at startup
═══════════════════════════════════════════════════

  Every conversation starts with:
    1. MEMORY.md content (always, ~2K tokens)
    2. Today's journal (if exists, ~1K tokens)
    3. Yesterday's journal (if exists, ~1K tokens)

  Scaled to model context size:
    < 16K context  → MEMORY.md only
    < 32K context  → MEMORY.md + today
    >= 32K context → MEMORY.md + today + yesterday

  Injected as system prompt sections:
    # Your Memory
    [MEMORY.md content]

    # Recent Context
    [today's journal]
    [yesterday's journal]


MOMENT 2: On-demand search via memory_search tool
═══════════════════════════════════════════════════

  User: "how did we fix that auth bug?"
    → LLM calls memory_search(query: "auth bug fix")
    → FTS5 MATCH query → BM25 scoring → temporal decay
    → Top 5 results returned as tool output
    → LLM responds with historical context

  Search scoring:
    final_score = bm25_score × e^(−λ × age_in_days)
    λ = ln(2) / 30  (30-day half-life)

    Today:      100% score retention
    7 days:     ~84%
    30 days:    50%
    90 days:    12.5%
    180 days:   ~1.6%

  MEMORY.md entries are NOT subject to temporal decay.


MOMENT 3: User reads/edits MEMORY.md directly
═══════════════════════════════════════════════════

  MEMORY.md is a plain markdown file.
  User can open in any editor, read, add, remove entries.
  GUI memory inspector provides visual interface.
```

---

## Memory Tools

### memory_write

```
Name:        memory_write
Description: Write important facts, decisions, or notes to persistent memory.
Parameters:
  content:   string  — what to remember
  target:    "memory" | "journal"
             "memory" → appends to MEMORY.md (always loaded, high priority)
             "journal" → appends to today's journal (searchable)

Behavior:
  target = "memory":
    Append to ~/.hlvm/memory/MEMORY.md under appropriate section.

  target = "journal":
    Append to ~/.hlvm/memory/journal/YYYY-MM-DD.md with ## HH:MM timestamp.

  After write: reindex changed file in FTS5 (chunk → insert).
```

### memory_search

```
Name:        memory_search
Description: Search past memories and journal entries.
Parameters:
  query:     string  — what to search for

Behavior:
  1. FTS5 MATCH query against chunks_fts table
  2. Apply temporal decay: score × e^(−λ × age_days)
  3. Return top 5 results: [{text, file, lineStart, lineEnd, score}]

Results returned as normal tool output. LLM reads and responds.
```

Both tools follow standard HLVM tool pattern — registered in tool registry,
called by LLM like any other tool (read_file, shell, etc.).

---

## Pre-Compaction Flush

### Why

The LLM context window is finite (128K-200K tokens). Like RAM. When full,
old messages must be compressed (compaction). Without flush, details are
lost. With flush, LLM saves important facts before compression.

### How

```
Orchestrator detects: token count > 80% of context window
  → Inject system message:
    "Context nearing limit. If there are important facts,
     decisions, or outcomes not yet saved, write them now."
  → LLM calls memory_write if needed
  → Normal compaction proceeds
  → One flush per compaction cycle (tracked in state)
```

### Why Not Avoid Compaction?

Context window = RAM. SSD = disk. You can have infinite disk but the model
can only process N tokens at a time. The memory system is virtual memory:
SSD-backed recall that survives the RAM eviction.

---

## Security and Privacy

| Risk | Mitigation |
|------|------------|
| Plaintext on disk | `chmod 700 ~/.hlvm/memory/` (owner-only) |
| Sensitive data auto-saved | Regex blocklist: never persist passwords, API keys, SSNs, credit cards |
| Cloud model receives memories | Warn on first use: "Your memories will be sent to [provider]. Continue?" |
| Backup exposure | Document: exclude `~/.hlvm/memory/` from cloud sync if privacy matters |
| Incomplete deletion | `memory_forget` (future): purge from markdown + SQLite |
| Data ownership | All local files. No cloud sync. No telemetry. User can rm -rf anytime. |

---

## Implementation

### New Files

```
src/hlvm/memory/
├── mod.ts          Barrel export
├── manager.ts      MemoryManager: load context, orchestrate reindex
├── store.ts        Read/write MEMORY.md + journal (SSOT: getPlatform().fs.*)
├── search.ts       SQLite FTS5 queries + temporal decay scoring
├── indexer.ts      Chunk text (~400 tokens, 80 overlap) → FTS5 insert
└── tools.ts        memory_search + memory_write tool definitions
```

### Modified Files

```
src/hlvm/agent/agent-runner.ts
  - Load memory context before session creation
  - Register memory_search + memory_write tools
  - Pass memory context to system prompt generation

src/hlvm/agent/orchestrator.ts
  - Pre-compaction flush: detect 80% → inject save prompt → then compact

src/hlvm/agent/llm-integration.ts
  - renderMemoryContext(): new system prompt section
    "# Your Memory" + "# Recent Context"
  - Scale loading to model context size

src/hlvm/agent/session.ts
  - Add memoryContext field in AgentSessionOptions

src/common/paths.ts
  - getMemoryDir()        → ~/.hlvm/memory/
  - getMemoryMdPath()     → ~/.hlvm/memory/MEMORY.md
  - getJournalDir()       → ~/.hlvm/memory/journal/
  - getMemoryIndexPath()  → ~/.hlvm/memory/index.sqlite
```

### SSOT Compliance

- File I/O: `getPlatform().fs.*` — never `Deno.*`
- Logging: `log.*` — never `console.*`
- Paths: `getPlatform().path.join()`
- SQLite: via `deno.land/x/sqlite3`

### Phases

**Phase 1: MEMORY.md + memory_write (~2 days)**
- Create src/hlvm/memory/ module
- Path helpers in common/paths.ts
- memory_write tool (writes to MEMORY.md or today's journal)
- Load MEMORY.md into system prompt at startup
- Register tool in agent-runner.ts
- **Result:** "Remember this" works. Next conversation knows the user.

**Phase 2: Journal + memory_search + FTS5 (~3 days)**
- SQLite FTS5 setup, query, temporal decay scoring
- Chunking pipeline (400 tokens, 80 overlap)
- memory_search tool (query → FTS5 → scored results)
- Auto-load today + yesterday journal at startup
- Reindex on every memory_write call
- **Result:** "How did we fix X?" finds it from weeks ago.

**Phase 3: Polish + hardening (~1 day)**
- Pre-compaction flush in orchestrator
- MEMORY.md size cap (~3K tokens) + consolidation
- Context-aware loading (scale to model size)
- Sensitive content filter (regex blocklist)
- Cloud provider memory warning
- **Result:** Long conversations safe. Secrets don't leak. MEMORY.md stays small.

---

## User Experience: Before vs After

### Before (no memory)

```
Day 1:  "I'm building a React app with Deno backend"
Day 5:  "add auth" → "What app? What framework?"
Day 12: "that cors bug" → "What CORS bug? What file?"
Day 30: "my usual setup" → "What setup?"
Day 90: "what did we decide?" → "No record of previous conversations."
```

### After (with memory)

```
Day 1:  "I'm building a React app with Deno backend"
        → LLM writes to journal + updates MEMORY.md with project info.

Day 5:  "add auth"
        → MEMORY.md has project details.
        → "For your React + Deno app, I'd suggest JWT. Want me to set it up?"

Day 12: "that cors bug"
        → memory_search finds fix from day 8.
        → "Last time it was Access-Control-Allow-Origin in /api/users.ts."

Day 30: "my usual setup"
        → MEMORY.md: Deno, JWT, SQLite, tabs.
        → "Scaffolding now."

Day 90: "what did we decide?"
        → memory_search finds decision from day 1.
        → "On Feb 20 we chose SQLite local, Postgres production."
```

---

## Growth Over Time

```
Month 1:  MEMORY.md ~10 entries. Stops asking basic questions.
Month 3:  ~30 entries + 90 journal files. Anticipates patterns.
Month 6:  ~50 entries + 180 journals. Knows your engineering history.
Month 12: Full second brain. "How did we fix X?" always has an answer.
```

The more you use it, the better it knows you.
The better it knows you, the more useful it is.
This is the compound effect that no stateless AI assistant can match.

---

## Relationship to Companion Agent

This memory system is the persistence layer for the companion agent
described in `docs/companion-agent-final.md`. The companion agent adds:

- Observation sources (file system, git, app focus)
- Proactive behavior (speak without being asked)
- Two-model strategy (cheap companion + powerful action model)
- GUI integration (SSE, consent, permissions)

The memory system works independently of the companion agent — it powers
the basic `hlvm ask` CLI flow as well. The companion agent builds on top.

```
Memory system:     remember + recall across conversations
Companion agent:   observe + act proactively + remember + recall

Memory works without companion. Companion requires memory.
```
