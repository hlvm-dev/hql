# HLVM Memory System

> The single authoritative document for HLVM's durable memory architecture. All
> other references point here.

---

## Vision

Every conversation is a continuation, not a cold start. The user should not need
to repeat durable facts, preferences, or decisions.

This system is:

- global across all projects
- assistant-visible
- durable across sessions
- explicitly non-chronological

This system is **not**:

- a substitute for ordered chat history
- project-scoped memory
- "remember literally everything forever" without filtering

---

## Contract

This document is both the architecture spec and the behavior contract.

Guaranteed behavior:

- `MEMORY.md` is always global and always loaded first.
- `memory.db` stores global durable facts.
- Plain chat and agent mode both share the same durable-memory capture path.
- Explicit requests like `remember that X` are persisted deterministically,
  without relying on the model choosing a tool call.
- High-confidence implicit facts from normal conversation may also be persisted
  automatically.
- Chronology questions must be answered from chat/session history or activity
  tools, not from durable memory.

Best-effort behavior:

- Additional relevant memory may be injected automatically based on the current
  user request.
- Implicit extraction is heuristic and conservative.
- Conflict invalidation is soft-delete based and may improve over time.

---

## Three Separate Systems

HLVM has three independent "memory-like" systems with distinct jobs. They do not
overlap. They do not share storage.

```
SYSTEM             PURPOSE                    STORAGE               UI
──────────────────────────────────────────────────────────────────────────
Prompt History      Up/Down arrow recall       history.jsonl         Keyboard
Agent Memory        AI remembers the user      MEMORY.md + memory.db REPL API
REPL Bindings       def/defn persistence       memory.hql            (bindings)
```

This document covers **Agent Memory** only. The other two are trivial and
self-contained.

---

## Architecture Overview

```
                     ┌─────────────────────────────────┐
                     │        User's REPL / CLI         │
                     └────────────┬────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
┌───────▼───────┐       ┌────────▼────────┐      ┌────────▼────────┐
│  (memory)     │       │ (remember "x")  │      │ memory.search() │
│  Opens editor │       │ Appends to      │      │ memory.add()    │
│  for MEMORY.md│       │ MEMORY.md       │      │ memory.clear()  │
└───────────────┘       └────────┬────────┘      └────────┬────────┘
                                 │                        │
                     ┌───────────▼────────────────────────▼──────────┐
                     │              REPL API (api/memory.ts)          │
                     │  MemoryCallable: function + properties         │
                     └───────────────────┬───────────────────────────┘
                                         │
               ┌─────────────────────────┼─────────────────────────┐
               │                         │                         │
     ┌─────────▼─────────┐    ┌──────────▼──────────┐   ┌────────▼─────────┐
     │   Explicit Layer   │    │   Implicit Layer     │   │  Agent Tools      │
     │   (MEMORY.md)      │    │   (memory.db)        │   │  (tools.ts)       │
     │                    │    │                      │   │                    │
     │  explicit.ts       │    │  facts.ts            │   │  memory_write      │
     │  - read            │    │  entities.ts         │   │  memory_search     │
     │  - append          │    │  retrieve.ts         │   │  memory_edit       │
     │  - replace         │    │  invalidate.ts       │   │                    │
     │  - clear           │    │  extract.ts          │   │  (LLM calls these  │
     │                    │    │  pipeline.ts         │   │   as tool calls)   │
     └─────────┬─────────┘    └──────────┬──────────┘   └────────┬─────────┘
               │                         │                        │
               └─────────────────────────┼────────────────────────┘
                                         │
                         ┌───────────────▼───────────────┐
                         │     Prompt Assembly            │
                         │     (manager.ts)               │
                         │                                │
                         │  1. Read MEMORY.md (priority)  │
                         │  2. Read DB facts (remainder)  │
                         │  3. Truncate to token budget   │
                         │  4. Wrap as system message     │
                         └───────────────┬───────────────┘
                                         │
                         ┌───────────────▼───────────────┐
                         │    "# Your Memory"             │
                         │    system message injected     │
                         │    into every AI conversation  │
                         └───────────────────────────────┘
```

---

## File Layout

```
~/.hlvm/memory/
├── MEMORY.md       # User-authored notes (priority 1, always loaded)
└── memory.db       # SQLite — auto-learned facts, entities, relationships
```

No index.sqlite. Two files only. This directory is global, not project-scoped.

---

## Two Layers

### Layer 1: Explicit Memory (MEMORY.md)

User-authored, human-readable, freely editable. The AI sees this every turn.

```markdown
# My Notes

Write anything here. The AI assistant will see this content every turn.

Use Deno for all projects. Deploy window: Tue-Thu only. Auth: JWT with refresh
tokens.
```

**Written by:** User (via editor) or `(remember "text")` in REPL. **Read by:**
Agent every turn (injected as system message). **Auto-created:** Yes, with
default template if missing.

### Layer 2: Implicit Memory (memory.db)

Auto-learned facts extracted from conversations. User never sees this directly.

**Schema:**

```sql
-- Core fact storage
CREATE TABLE facts (
  id            INTEGER PRIMARY KEY,
  content       TEXT NOT NULL,
  category      TEXT DEFAULT 'General',
  source        TEXT DEFAULT 'memory',
  valid_from    TEXT,            -- ISO date (YYYY-MM-DD)
  valid_until   TEXT,            -- NULL = active, date = soft-deleted
  created_at    TEXT,
  accessed_at   TEXT,
  access_count  INTEGER DEFAULT 0,
  embedding     BLOB,           -- future: vector embeddings
  embedding_model TEXT
);

-- FTS5 full-text search
CREATE VIRTUAL TABLE facts_fts USING fts5(content, content=facts, content_rowid=id);

-- Entity graph
CREATE TABLE entities (
  id   INTEGER PRIMARY KEY,
  name TEXT UNIQUE,
  type TEXT    -- file, runtime, tool, concept
);

CREATE TABLE relationships (
  id          INTEGER PRIMARY KEY,
  from_entity INTEGER REFERENCES entities(id),
  to_entity   INTEGER REFERENCES entities(id),
  relation    TEXT,       -- appears_in, co_occurs
  fact_id     INTEGER REFERENCES facts(id),
  valid_until TEXT
);
```

**Written by:** Agent tool calls + deterministic explicit-save requests +
post-turn heuristic extraction. **Read by:** Prompt assembly (fills remaining
token budget after MEMORY.md). **Soft-deleted:** Facts are never hard-deleted —
`valid_until` marks invalidation.

---

## Data Flow: Writing

```
PATH 1: Explicit deterministic save (primary for "remember that ...")
══════════════════════════════════════════════════════

  User: "remember that I prefer Deno"
    → extractExplicitMemoryRequests()
    → persistExplicitMemoryRequest()
    → writeMemoryFacts() → pipeline.ts
    → Saved without requiring a model tool call


PATH 2: Agent writes during conversation
══════════════════════════════════════════════════════

  User: "let's use Postgres instead of SQLite for production"
    → LLM calls memory_write({content: "...", section: "Decisions"})
    → pipeline.ts: insertFact() + linkFactEntities() + detectConflicts()
    → If frontier model: autoInvalidateConflicts() (Jaccard ≥ 0.9)


PATH 3: User writes explicitly via REPL
══════════════════════════════════════════════════════

  (remember "deploy only on weekdays")
    → appendExplicitMemoryNote()
    → Appended to MEMORY.md


PATH 4: Post-turn heuristic extraction (plain chat + agent mode)
══════════════════════════════════════════════════════

  Turn completes → extractConversationFacts({userMessage, assistantMessage})
    → Explicit remember detection
    → High-confidence user preferences / decisions / profile / workflow facts
    → Conservative grounded assistant outcome extraction (e.g. fixes)
    → Dedup against existing facts
    → persistConversationFacts() → batch insert via pipeline


PATH 5: Pre-compaction flush (safety net)
══════════════════════════════════════════════════════

  Context window ~80% full
    → Orchestrator injects: "Save any unsaved facts before compaction"
    → LLM calls memory_write if needed
    → Normal compaction proceeds
```

---

## Data Flow: Reading

```
MOMENT 1: Every conversation start — system prompt injection
═════════════════════════════════════════════════════════════

  loadMemorySystemMessage(contextWindow)
    │
    ├─ Budget = min(contextWindow × 15%, 6000 tokens)
    │
    ├─ Priority 1: readExplicitMemory()
    │  └─ MEMORY.md content → truncate to budget
    │  └─ remainingTokens = budget − MEMORY.md tokens
    │
    ├─ Priority 2: getValidFacts({limit: N})
    │  └─ N = 120 (≥32K ctx) | 60 (≥16K) | 30 (<16K)
    │  └─ Ordered by: access_count DESC, created_at DESC
    │  └─ Grouped by category → truncate to remaining budget
    │
    └─ Result:
       ┌──────────────────────────────────────┐
       │ # Your Memory                         │
       │ This memory is durable, global, and   │
       │ non-chronological.                    │
       │                                       │
       │ [User's MEMORY.md content]            │
       │ ---                                   │
       │ ## Preferences                        │
       │ - Use Deno for all projects           │
       │ ## Decisions                           │
       │ - JWT with refresh tokens for auth    │
       └──────────────────────────────────────┘


MOMENT 2: Automatic relevant recall for the current request
═════════════════════════════════════════════════════════════

  User: "what runtime do I prefer?"
    → buildRelevantMemoryRecall(query)
    → retrieveMemory(query, 3)
    → Inject a second system message:
       "[Memory Recall] Relevant notes from earlier work: ..."


MOMENT 3: On-demand search via memory_search tool
═════════════════════════════════════════════════════════════

  User: "how did we fix that auth bug?"
    → LLM calls memory_search({query: "auth bug fix"})
    → Hybrid retrieval:
       1. FTS5 BM25 search (keyword match)
       2. Entity graph traversal (conceptual links)
       3. Merge, deduplicate by factId
       4. Apply temporal decay × access boost
       5. Return top N results


MOMENT 4: User reads/edits MEMORY.md directly
═════════════════════════════════════════════════════════════

  (memory)   → Opens ~/.hlvm/memory/MEMORY.md in native editor
  User edits → AI sees changes next turn (no restart needed)
```

---

## Retrieval Algorithm

Hybrid retrieval combines two signals:

```
Query: "JWT auth configuration"
       │
  ┌────┴─────────────────────┐
  │                          │
  ▼                          ▼
FTS5 Search              Entity Graph
(keyword match)          (conceptual links)
  │                          │
  │  BM25 scored             │  Extract entities from query
  │  Fetch 3× limit          │  → ["JWT", "auth"]
  │                          │  Find facts mentioning each
  │                          │  Base score: 0.2
  │                          │
  └────────────┬─────────────┘
               │
               ▼
         Merge by factId
               │
               ▼
       Apply Scoring:
       ┌─────────────────────────────────────────────┐
       │  final = raw_score × temporal_decay × boost  │
       │                                              │
       │  temporal_decay = e^(−λ × age_days)          │
       │  λ = ln(0.5) / 30   (30-day half-life)      │
       │                                              │
       │  boost = 1 + ln(1 + access_count)            │
       └─────────────────────────────────────────────┘
               │
               ▼
       Sort DESC, limit N
       touchFact() for each result
```

**Decay examples:**

| Age     | Decay Factor |
| ------- | ------------ |
| Now     | 1.0          |
| 7 days  | ~0.84        |
| 30 days | 0.5          |
| 60 days | 0.25         |
| 90 days | 0.125        |

Facts decay in _search ranking_, not deletion. Old facts still exist.

---

## Conflict Detection & Auto-Invalidation

When a new fact is written, the system detects conflicting older facts:

```
New fact: "Use Postgres for production"
  │
  ▼
searchFactsFts("Postgres production")
  │
  ▼
For each candidate:
  │
  ├─ Tokenize both facts
  ├─ Jaccard similarity = |A ∩ B| / |A ∪ B|
  │
  ├─ Score > 0.4 → candidate conflict
  │   (same category + different content required)
  │
  └─ Score ≥ 0.9 AND frontier model → auto-invalidate
     └─ SET valid_until = today (soft-delete)
```

**Model tiers:**

| Tier       | Auto-extraction                                    | Auto-invalidation |
| ---------- | -------------------------------------------------- | ----------------- |
| `weak`     | Deterministic explicit save + heuristic extraction | Never             |
| `mid`      | Deterministic explicit save + heuristic extraction | Never             |
| `frontier` | Deterministic explicit save + heuristic extraction | Jaccard ≥ 0.9     |

---

## Entity Graph

Facts are automatically linked to entities for graph-based retrieval:

```
Fact: "Fixed CORS bug in /api/users.ts using Deno"
  │
  ▼
extractEntitiesFromText()
  │
  ├─ file:    /api/users.ts  (regex: *.ts, *.js, *.json, etc.)
  ├─ runtime: deno           (hardcoded set)
  ├─ concept: CORS           (CamelCase detection)
  │
  ▼
linkFactEntities(factId, text)
  │
  ├─ UPSERT entities (deno, /api/users.ts, CORS)
  └─ INSERT relationships
     ├─ (deno, deno, appears_in, factId)
     ├─ (/api/users.ts, /api/users.ts, appears_in, factId)
     ├─ (CORS, CORS, appears_in, factId)
     ├─ (deno, /api/users.ts, co_occurs, factId)
     ├─ (deno, CORS, co_occurs, factId)
     └─ (/api/users.ts, CORS, co_occurs, factId)
```

Entity types: `file`, `runtime`, `tool`, `concept`.

---

## Agent Tools

Three tools registered in the agent's tool registry:

### memory_write

```
Parameters:
  content   string   (required)  What to remember
  section   string   (optional)  Category (default: "General")

Returns:
  { written: true, factId: 42, linkedEntities: 3, invalidated: 1 }

Pipeline:
  content → sanitizePII → insertFact → linkFactEntities → detectConflicts
```

### memory_search

```
Parameters:
  query     string   (required)  Search keywords
  limit     number   (optional)  Max results (default: 5)

Returns:
  { query: "...", results: [{source, text, date, score}], count: N }

Pipeline:
  query → FTS5 BM25 → entity graph → merge → decay + boost → top N
```

### memory_edit

```
Parameters:
  action    string   (required)  "delete_section" | "replace" | "clear_all"
  section   string   For delete_section: category name
  find      string   For replace: text to find
  replace_with string For replace: replacement text
  confirm   boolean  For clear_all: must be true

Returns:
  { edited: true, action: "...", invalidated?: N, replacements?: N }
```

---

## REPL API

The REPL exposes memory as a callable object with methods:

```
(memory)                      → Opens MEMORY.md in native editor
(remember "prefer tabs")      → Appends note to MEMORY.md
(memory.search "macbook")     → Searches notes + DB facts
(memory.add "text" "cat")     → Adds a fact to DB
(memory.replace "old" "new")  → Find/replace across both stores
(memory.clear true)           → Nuke everything (notes + all facts)
(memory.get)                  → Returns snapshot object
(memory.appendNote "text")    → Same as (remember "text")
memory.notesPath              → ~/.hlvm/memory/MEMORY.md
memory.dbPath                 → ~/.hlvm/memory/memory.db
```

**Implementation:** `api/memory.ts` creates a `MemoryCallable` — a function with
properties. `helpers.ts` wraps it so bare `(memory)` opens the editor, while
`memory.*` methods pass through.

---

## PII Sanitization

All fact content is sanitized before DB write:

```
Pattern                              Example blocked
─────────────────────────────────    ─────────────────
\b\d{3}[-.]?\d{2}[-.]?\d{4}\b       SSN: 123-45-6789
\b\d{4}[\s-]?\d{4}[\s-]?\d{4}...    Credit card: 4111...
\b(sk|pk|api[_-]?key|secret)...     API key: sk_live_abc123...
(password|passwd|pwd)\s*[:=]...      password=hunter2
```

---

## Prompt Assembly

`manager.ts` is the single point of truth for building the memory system
message:

```
loadMemoryContext(contextWindow: number)
  │
  ├─ maxTokens = min(contextWindow × 0.15, 6000)
  │
  ├─ MEMORY.md → truncateToTokenBudget(maxTokens)
  │  └─ remainingTokens -= md tokens used
  │
  ├─ DB facts → getValidFacts({limit: N})
  │  └─ N = 120 (≥32K) | 60 (≥16K) | 30 (<16K)
  │  └─ Group by category → "## Cat\n- fact\n- fact"
  │  └─ truncateToTokenBudget(remainingTokens)
  │
  └─ Combine: mdSection + "---" + dbSection

buildMemorySystemMessage(context)
  → "# Your Memory\n[caveats]\n\n[context]"

Result: { role: "system", content: "# Your Memory\n..." }
```

**Key:** Memory is **always a separate system message** — never embedded in the
main prompt. Identified by the `"# Your Memory"` header marker.

---

## Auto-Extraction Pipeline

At session end, facts are extracted from conversation messages:

```
Session messages (last 20)
       │
       ▼
Regex Baseline (all models)
├─ "my name is X"        → Identity
├─ "i prefer/like/use X" → Preferences
├─ "we decided to X"     → Decisions
├─ "fixed/resolved X"    → Bugs
       │
       ▼
[Frontier only] LLM Extraction
├─ Send messages to LLM with extraction prompt
├─ Parse JSON response → max 10 facts
└─ Fallback to regex if LLM fails
       │
       ▼
Dedup & Persist
├─ Skip duplicates (category + lowercase content match)
├─ Filter: skip code blocks, min 8 chars, skip false positives
└─ writeMemoryFacts() → batch insert via pipeline
```

**Categories:** Identity, Preferences, Decisions, Bugs, Environment, General.

---

## Security

| Risk                    | Mitigation                                                     |
| ----------------------- | -------------------------------------------------------------- |
| Plaintext on disk       | `chmod 0o700 ~/.hlvm/memory/` (owner-only)                     |
| PII auto-saved          | Regex sanitization before every DB write                       |
| Cloud model sees memory | Memory injected as system message — user controls model choice |
| Data ownership          | All local. No cloud sync. No telemetry. `rm -rf` anytime.      |

---

## Module Map

```
src/hlvm/memory/
├── mod.ts           Barrel export (public API)
├── manager.ts       Prompt assembly: loadMemoryContext, buildMemorySystemMessage
├── explicit.ts      MEMORY.md I/O: read, append, replace, clear
├── db.ts            SQLite init, schema, migrations (WAL mode)
├── facts.ts         Fact CRUD: insert, invalidate, search, touch
├── entities.ts      Entity graph: extract, link, traverse
├── retrieve.ts      Hybrid retrieval: FTS5 + graph + decay + boost
├── invalidate.ts    Conflict detection: Jaccard similarity
├── extract.ts       Auto-extraction: regex + LLM (frontier)
├── pipeline.ts      Write pipeline: normalize, dedup, insert, link
├── tools.ts         Agent tools: memory_write, memory_search, memory_edit
├── store.ts         Shared utils: warnMemory, todayDate, sanitizePII
└── policy.ts        isPersistentMemoryEnabled()

src/hlvm/api/
└── memory.ts        REPL API: MemoryCallable (function + properties)

src/hlvm/cli/repl/
├── helpers.ts       (memory) → open editor, (remember) → append
└── commands.ts      /help text for memory functions

src/common/
└── paths.ts         getMemoryDir, getMemoryMdPath, getMemoryDbPath
```

---

## How to Nuke Memory

**Selective edit** — open and edit MEMORY.md:

```
(memory)
```

**Clear all** — programmatic nuke via REPL:

```
(memory.clear true)
```

Soft-invalidates all DB facts + clears MEMORY.md content.

**Manual delete** — filesystem reset:

```bash
rm -rf ~/.hlvm/memory/
```

Both files gone. Auto-recreates with blank template next session.

---

## User Experience

```
Day 1:   "I'm building a React app with Deno backend"
         → Agent auto-extracts: project info, runtime preference

Day 5:   "add auth"
         → MEMORY.md has project details
         → "For your React + Deno app, I'd suggest JWT."

Day 12:  "that cors bug"
         → memory_search finds fix from day 8
         → "Last time it was Access-Control-Allow-Origin in /api/users.ts."

Day 30:  "my usual setup"
         → MEMORY.md: Deno, JWT, SQLite
         → "Scaffolding with your usual stack."

Day 90:  "what did we decide about the database?"
         → memory_search finds decision from day 1
         → "On Feb 20 we chose SQLite local, Postgres production."
```

The more you use it, the better it knows you. The better it knows you, the more
useful it is. This is the compound effect that no stateless AI assistant can
match.
