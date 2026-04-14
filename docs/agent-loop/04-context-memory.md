# Context Management & Memory

`context.ts` (790 LOC) — token budget, compaction, message history.

## ContextManager Architecture

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  ContextManager                                    context.ts:304  │
  │                                                                    │
  │  ┌─── Config ──────────────────────────────────────────────────┐   │
  │  │  maxTokens:           32,000 (default, varies by model)     │   │
  │  │  compactionThreshold: 0.8 (80%)                             │   │
  │  │  overflowStrategy:    "trim" | "fail" | "summarize"        │   │
  │  │  preserveSystem:      true                                  │   │
  │  │  minMessages:         2                                     │   │
  │  │  summaryKeepRecent:   4                                     │   │
  │  └─────────────────────────────────────────────────────────────┘   │
  │                                                                    │
  │  ┌─── State ───────────────────────────────────────────────────┐   │
  │  │  messages[]        the conversation history                 │   │
  │  │  totalChars        O(1) token estimation cache              │   │
  │  │  pendingCompaction armed when tokens > threshold            │   │
  │  │  compactionRevision incremented on compact/trim             │   │
  │  │  messageRevision   incremented on add/set                   │   │
  │  │  roleCounts        {system, user, assistant, tool}          │   │
  │  └─────────────────────────────────────────────────────────────┘   │
  │                                                                    │
  │  ┌─── Callbacks ───────────────────────────────────────────────┐   │
  │  │  llmSummarize?     LLM-powered compaction (if "summarize") │   │
  │  │  buildRestorationHints?  file state after compaction        │   │
  │  └─────────────────────────────────────────────────────────────┘   │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## Token Counting — O(1)

```
  addMessage(msg)
    │
    ├─ totalChars += msg.content.length + estimateToolCallChars(msg)
    │
    └─ estimateTokens() = estimateTokensFromCharCount(totalChars, modelKey)
                           ↓
                         totalChars × model-specific ratio
                         (no per-message iteration)
```


## Message Lifecycle

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                                                                    │
  │  addMessage(msg)                                   context.ts:342  │
  │    │                                                               │
  │    ├─ add timestamp if missing                                     │
  │    ├─ estimate tool call character overhead                        │
  │    │                                                               │
  │    ├─ OVERFLOW CHECK (strategy-dependent):                         │
  │    │    "fail"      → throw ContextOverflowError if exceeds       │
  │    │    "trim"      → append, then trimIfNeeded()                 │
  │    │    "summarize" → append, arm pendingCompaction at 80%        │
  │    │                                                               │
  │    ├─ append to messages[]                                         │
  │    ├─ update totalChars, roleCounts, messageRevision               │
  │    │                                                               │
  │    └─ if estimateTokens() > maxTokens * 0.8:                      │
  │         pendingCompaction = true                                   │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘
```


## Three Overflow Strategies

```
  ═══════════════════════════════════════════════════════════════════════
  STRATEGY: "trim" (default)
  ═══════════════════════════════════════════════════════════════════════

    When tokens exceed budget:
      1. Separate system messages (preserved)
      2. Group non-system messages by roundId
      3. Remove oldest groups from front
         until tokens ≤ maxTokens or messages ≤ minMessages
      4. Update totalChars, increment compactionRevision

    ┌──────────────────────────────────────────────────────────────────┐
    │  BEFORE:                                                        │
    │  [sys] [usr1] [ast1] [tool1] [usr2] [ast2] [tool2] [usr3]      │
    │   ▲                                                             │
    │   preserved                   ← removed →           ← kept →   │
    │                                                                 │
    │  AFTER:                                                         │
    │  [sys] [usr2] [ast2] [tool2] [usr3]                             │
    └──────────────────────────────────────────────────────────────────┘

    Pros: Fast, no LLM call needed
    Cons: Loses older context entirely


  ═══════════════════════════════════════════════════════════════════════
  STRATEGY: "summarize"
  ═══════════════════════════════════════════════════════════════════════

    When pendingCompaction armed AND orchestrator calls compactIfNeeded():
      1. Split system / non-system
      2. Identify recent messages to preserve (summaryKeepRecent: 4)
      3. prepareMessagesForCompaction():
           Replace microcompactable tool results with sentinel
           (read_file, search_code, shell_exec, etc → "[compacted]")
      4. Call llmSummarize(prepared) → LLM generates summary
      5. Build restoration hints (file state recovery messages)
      6. Replace messages: [sys, summary, ...restored, ...recent]

    ┌──────────────────────────────────────────────────────────────────┐
    │  BEFORE (at 80%+ capacity):                                     │
    │  [sys][u1][a1][t1][u2][a2][t2][u3][a3][t3][u4][a4][t4][u5]     │
    │   ▲   ─────── to summarize ──────────   ─── keep recent ───    │
    │   preserved                                                     │
    │                                                                 │
    │  STEP 3 — Microcompact:                                        │
    │  [sys][u1][a1]["compacted"][u2][a2]["compacted"][u3]... → LLM   │
    │                                                                 │
    │  STEP 4 — LLM Summary:                                        │
    │  "The user explored file X, found bug Y, edited Z..."          │
    │                                                                 │
    │  AFTER:                                                         │
    │  [sys][summary][restored files][u4][a4][t4][u5]                 │
    └──────────────────────────────────────────────────────────────────┘

    Pros: Preserves semantic content, recent context intact
    Cons: Requires LLM call (~1-3s), may lose nuance


  ═══════════════════════════════════════════════════════════════════════
  STRATEGY: "fail"
  ═══════════════════════════════════════════════════════════════════════

    On addMessage: if projected tokens > maxTokens → throw
    Used by: engine-sdk.ts for strict context limits

    Pros: Never loses data silently
    Cons: Caller must handle ContextOverflowError
```


## Compaction in the Orchestrator

```
  EVERY TURN (orch.ts:1773-1841):

    ┌─ Calculate pressure ──────────────────────────────────────────┐
    │  pct = (estimateTokens() / maxTokens) * 100                   │
    │  emit { type: "context_pressure", percent: pct }              │
    └───────────────────────────────────────────────────────────────┘
                 │
                 ▼
    ┌─ Pre-compaction memory flush (:1800) ─────────────────────────┐
    │                                                                │
    │  IF all of:                                                    │
    │    ✓ context.isPendingCompaction                               │
    │    ✓ pct >= 80%                                                │
    │    ✓ !memoryFlushedThisCycle                                   │
    │    ✓ memory_write tool available                               │
    │                                                                │
    │  THEN:                                                         │
    │    inject "call memory_write NOW to save context"              │
    │    skipCompaction = true   ← give model a chance to save       │
    │    (compaction will fire NEXT turn if still needed)            │
    │                                                                │
    └───────────────────────────────────────────────────────────────┘
                 │
                 ▼
    ┌─ Proactive compaction (:1817) ────────────────────────────────┐
    │                                                                │
    │  IF all of:                                                    │
    │    ✓ !skipCompaction                                           │
    │    ✓ context.isPendingCompaction                               │
    │    ✓ pct >= 80%                                                │
    │    ✓ messageRevision changed since last compaction             │
    │                                                                │
    │  THEN:                                                         │
    │    beforeTokens = estimateTokens()                             │
    │    context.compactIfNeeded()  ← LLM summarization             │
    │    afterTokens = estimateTokens()                              │
    │    emit { type: "context_compaction", before, after }          │
    │                                                                │
    └───────────────────────────────────────────────────────────────┘


  TIMELINE (typical long session):

    Turn 1-15:   tokens < 80%  → no compaction
    Turn 16:     tokens = 82%  → pendingCompaction armed
                                → memory flush: "save context now"
    Turn 17:     tokens = 84%  → compactIfNeeded()
                                → LLM summarizes turns 1-13
                                → tokens drop to ~40%
    Turn 18-30:  tokens < 80%  → no compaction
    Turn 31:     tokens = 81%  → cycle repeats
```


## Memory System Integration

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  MEMORY LIFECYCLE IN THE REACT LOOP                                │
  │                                                                    │
  │  SESSION START (session.ts:577):                                   │
  │    injectPersistentMemoryContext()                                  │
  │      └─ loadMemoryContext() → pinned top-10 facts                  │
  │         added as separate system message: "# Your Memory"          │
  │                                                                    │
  │  PRE-LLM (orchestrator.ts:1768):                                   │
  │    maybeInjectMemoryRecall(state, config)                          │
  │      └─ buildRelevantMemoryRecall()                                │
  │           retrieveMemory(query) → FTS5 + entity graph              │
  │           injected as [System Reminder] user message               │
  │                                                                    │
  │  DURING LOOP (tool execution):                                     │
  │    LLM calls memory_write → insertFact + linkEntities             │
  │    LLM calls memory_search → retrieveMemory(query)                │
  │                                                                    │
  │  PRE-COMPACTION (orchestrator.ts:1800):                            │
  │    "Call memory_write NOW to save important context"               │
  │    → model saves key facts before context is summarized            │
  │                                                                    │
  │  SESSION REUSE (session.ts:327):                                   │
  │    re-inject fresh memory (allows new facts from prior turn)       │
  │    skip stale "# Your Memory" message from old session             │
  │                                                                    │
  └─────────────────────────────────────────────────────────────────────┘


  MEMORY RETRIEVAL ARCHITECTURE (retrieve.ts):

    query
      │
      ├─ FTS5 full-text search (BM25 ranking)
      │    temporal decay: 30-day half-life on `date` field
      │
      ├─ Entity graph traversal
      │    query → extract entities → follow relationships
      │    → find facts linked to those entities
      │
      └─ Deduplicate via Map (fact ID)
         → ranked results, max 10 pinned
```


## Message Types in Context

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Message { role, content, roundId?, timestamp?, attachments?, ... } │
  │                                                                      │
  │  role: "system"                                                      │
  │    ├─ compiled system prompt (persona + tool docs + cache segments)  │
  │    └─ persistent memory ("# Your Memory")                           │
  │                                                                      │
  │  role: "user"                                                        │
  │    ├─ user's actual request                                         │
  │    ├─ [System Reminder] memory recall                               │
  │    ├─ [Runtime Directive] nudges (continue, save context, etc.)     │
  │    ├─ [Runtime Notice] warnings                                     │
  │    ├─ [Runtime Update] agent status                                 │
  │    └─ [Parent Message] parent→child steering                        │
  │                                                                      │
  │  role: "assistant"                                                   │
  │    ├─ LLM text response                                             │
  │    └─ LLM tool_calls metadata                                       │
  │                                                                      │
  │  role: "tool"                                                        │
  │    ├─ tool execution results (full or summarized)                   │
  │    └─ screenshot image attachments (if vision-capable)              │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```
