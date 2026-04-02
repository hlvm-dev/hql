# Web Search & Web RAG — Full Takeover Thesis

> **Purpose:** Enable any GenAI with zero prior context to understand, compare, and continue
> web search / web RAG work in HLVM and Claude Code.
>
> **Date:** 2026-04-03
>
> **Workspaces:**
> - HLVM: `<hlvm-repo>`
> - Claude Code reference: `<claude-code-ref>`

---

## 0. Critical Disambiguation

There are **two completely separate retrieval systems** in HLVM. Do NOT confuse them:

| System | What it retrieves | Where it lives | Key entry point |
|--------|-------------------|----------------|-----------------|
| **Web RAG** | Live external content from the internet | `src/hlvm/agent/tools/web/`, `tool-capabilities.ts`, `native-web-tools.ts` | `search_web` / `web_fetch` / `fetch_url` tools |
| **Memory RAG** | Local facts from the app's own SQLite store | `src/hlvm/memory/` | `retrieveMemory()` in `retrieve.ts` |

This document covers **Web RAG only**.

---

## 1. What "Web Search / Web RAG" Means

Web RAG is the pipeline that:
1. Accepts a user question that requires live web information
2. Decides whether to use **provider-native search** (e.g., Anthropic's server-side `web_search`) or **custom/local search** (e.g., DuckDuckGo)
3. Optionally **fetches and parses pages** for deeper evidence
4. Returns results with **grounded citations** back to the model

---

## 2. Architecture Comparison — How Each System Works

### 2A. Claude Code Architecture

```
user query
  → main Anthropic API query loop (claude.ts)
  → model decides to call WebSearch or WebFetch

WebSearchTool (tools/WebSearchTool/WebSearchTool.ts)
  → makes a SECONDARY model call to Anthropic
  → forces server tool: web_search_20250305
  → extracts: server_tool_use → web_search_tool_result → text+citations
  → returns structured { query, results[], durationSeconds }

WebFetchTool (tools/WebFetchTool/WebFetchTool.ts)
  → fetches URL itself via axios (tools/WebFetchTool/utils.ts)
  → converts HTML to markdown via turndown
  → summarizes/extracts via secondary Haiku model call (queryHaiku)
  → returns { bytes, code, result, durationMs, url }

Usage accounting (services/api/claude.ts + emptyUsage.ts)
  → server_tool_use.web_search_requests (integer counter)
  → server_tool_use.web_fetch_requests (integer counter)
  → accumulated per-message, rolled up in cost-tracker.ts
  → getTotalWebSearchRequests() exported for display
```

**CC's key design choices:**
- **Product/Anthropic-centric:** WebSearch is a thin product wrapper around Anthropic's server-side `web_search_20250305` tool
- **Secondary model call:** WebSearchTool makes its OWN API call with `extraToolSchemas: [toolSchema]`, not inline in the main loop
- **Server tool streaming:** Streams `server_tool_use` + `web_search_tool_result` content blocks, parses them into `SearchResult[]`
- **Feature-flagged model:** Can use Haiku (`tengu_plum_vx3` flag) or main model for web search
- **Max 8 searches** per tool call (`max_uses: 8` hardcoded)
- **Domain blocklist preflight:** Calls `api.anthropic.com/api/web/domain_info` before fetching any URL
- **Preapproved hosts:** ~130 code-related domains (docs.python.org, react.dev, etc.) bypass permission checks for WebFetch
- **15-minute LRU cache** (50MB limit) for fetched URL content
- **Separate domain check cache** (5 min, 128 entries) to avoid redundant preflight calls
- **Redirect safety:** Only follows same-host redirects (with www. normalization); cross-host redirects return info for user to re-fetch
- **IP protection:** Copyright-aware prompt for non-preapproved domains (125-char quote limit, quotation marks required)
- **Binary content handling:** Saves PDFs/images to disk, still attempts Haiku summary of decoded text
- **Provider gating:** Enabled for firstParty, Vertex (Claude 4.0+), Foundry; disabled for other providers
- **Web search beta header:** `web-search-2025-03-05` in `constants/betas.ts`

**CC files (complete list):**

| File | Lines | Role |
|------|-------|------|
| `tools/WebSearchTool/WebSearchTool.ts` | 436 | Search tool: secondary model call + server tool parsing |
| `tools/WebSearchTool/prompt.ts` | 35 | Search prompt: citation requirements, year guidance |
| `tools/WebSearchTool/UI.tsx` | ~100 | Search UI rendering |
| `tools/WebFetchTool/WebFetchTool.ts` | 319 | Fetch tool: URL fetch + Haiku summarization |
| `tools/WebFetchTool/prompt.ts` | 47 | Fetch prompt + secondary model prompt template |
| `tools/WebFetchTool/utils.ts` | 531 | Fetch core: cache, domain check, redirect handling, HTML→markdown |
| `tools/WebFetchTool/preapproved.ts` | 167 | ~130 preapproved code-related domains |
| `tools/WebFetchTool/UI.tsx` | ~100 | Fetch UI rendering |
| `constants/betas.ts` | 53 | Beta headers including `web-search-2025-03-05` |
| `services/api/emptyUsage.ts` | 23 | Usage shape: `server_tool_use.{web_search_requests, web_fetch_requests}` |
| `services/api/claude.ts` | ~3000 | API layer: streams server_tool_use, accumulates web usage |
| `cost-tracker.ts` | ~200 | Cost display: `getTotalWebSearchRequests()` |

### 2B. HLVM Architecture

```
user query
  → session creation resolves ResolvedProviderExecutionPlan (tool-capabilities.ts)
  → plan decides per capability: native | custom | disabled
  → native tools injected via SDK (native-web-tools.ts → engine-sdk.ts)
  → custom tools registered as normal agent tools (web-tools.ts)

Provider-native path (when supported):
  → SDK injects provider-specific tool (e.g., OpenAI webSearch, Anthropic webSearch_20250305)
  → model calls it natively; results come back through provider response
  → orchestrator SKIPS local execution for provider-executed tools
  → grounded citations preferred in final response

Custom/local path (fallback or when provider lacks native):
  → search_web tool → DuckDuckGo backend
       → query intent detection (query-strategy.ts)
       → DDG search API call (duckduckgo.ts)
       → optional prefetch of top results (ddg-search-backend.ts)
       → passage extraction + BM25-like ranking (search-ranking.ts)
       → source authority classification (source-authority.ts)
       → deterministic + optional LLM-guided result selection (search-result-selector.ts)
       → citation spans tracked (citation-spans.ts)
  → web_fetch tool → HTML parser / readability / headless Chrome fallback
  → fetch_url tool → raw HTTP fetch
```

**HLVM's key design choices:**
- **Provider-agnostic core:** Single execution plan works across OpenAI, Anthropic, Claude Code, Google, Ollama
- **Session-scoped routing:** Plan resolved ONCE at session creation, not per tool call
- **Conservative native gating:** Native page-read (`urlContext`) only for dedicated allowlist (semantic parity unproven)
- **Rich custom fallback:** DuckDuckGo backend with prefetch, intent detection, multi-tier ranking, evidence extraction
- **Three distinct tools:** `search_web` (search), `web_fetch` (readability parse), `fetch_url` (raw HTTP)
- **Per-run budgets:** search_web (15), web_fetch (25), fetch_url (25) calls
- **Deterministic + optional LLM:** Always have deterministic ranking; frontier models optionally enhance
- **Evidence-first presentation:** Fetched passages > snippets in LLM content
- **Low-confidence recovery:** Auto-generate related-links fallback
- **Headless Chrome fallback:** Only when static content < 512 chars
- **Citation tracking:** Full span-based citation system (startIndex, endIndex, sourceId, confidence)
- **Source authority classification:** official_docs, vendor_docs, repo_docs, technical_article, forum, other

**HLVM files (complete list):**

| File | Lines | Role |
|------|-------|------|
| **Core Architecture** | | |
| `agent/tool-capabilities.ts` | 620 | Capability SSOT, ResolvedProviderExecutionPlan |
| `providers/native-web-tools.ts` | 144 | Provider-native tool injection per provider |
| `agent/engine-sdk.ts` | ~250 | SDK wiring, native tool injection |
| `agent/session.ts` | ~400 | Session planning, execution plan resolution |
| `agent/orchestrator-tool-execution.ts` | ~300 | Provider-native tool filtering |
| **Web Tools & Configuration** | | |
| `agent/tools/web-tools.ts` | 1,058 | search_web, web_fetch, fetch_url implementations |
| `agent/web-config.ts` | 29 | Configuration loader |
| `prompt/sections.ts` | ~800 | Prompt integration, web guidance |
| **Search Provider & Registry** | | |
| `agent/tools/web/search-provider.ts` | 203 | Provider registry, domain filtering |
| `agent/tools/web/search-provider-bootstrap.ts` | 22 | One-time DuckDuckGo init |
| **Query & Ranking** | | |
| `agent/tools/web/query-strategy.ts` | 415 | Intent detection, query variants |
| `agent/tools/web/search-ranking.ts` | 606 | BM25-like scoring, passage extraction |
| `agent/tools/web/search-result-selector.ts` | 1,088 | Deterministic + LLM-guided selection |
| **Backend & Processing** | | |
| `agent/tools/web/ddg-search-backend.ts` | 712 | Search + prefetch + ranking orchestration |
| `agent/tools/web/duckduckgo.ts` | 533 | DuckDuckGo API adapter |
| `agent/tools/web/html-parser.ts` | 664 | HTML extraction, readability |
| `agent/tools/web/headless-chrome.ts` | 381 | Chrome rendering fallback |
| `agent/tools/web/fetch-core.ts` | 268 | HTTP fetching, redirects, byte limits |
| `agent/tools/web/source-authority.ts` | 226 | Source classification |
| **Utilities** | | |
| `agent/tools/web/citation-spans.ts` | 589 | Citation tracking, formatting |
| `agent/tools/web/web-utils.ts` | 67 | Small utilities |
| `agent/tools/web/intent-patterns.ts` | 62 | Regex patterns for intent |
| **Total** | **~7,900** | |

---

## 3. Provider Behavior Matrix

### HLVM

| Provider | web_search | web_fetch | fetch_url | remote_code_execute |
|----------|-----------|-----------|-----------|---------------------|
| OpenAI | native | custom | custom | disabled |
| Anthropic | native | custom | custom | explicit native |
| Claude Code | native | custom | custom | explicit native |
| Google | native | dedicated native | custom | explicit native |
| Ollama | custom | custom | custom | disabled |

### Claude Code

| Provider | WebSearch | WebFetch |
|----------|-----------|---------|
| firstParty (Anthropic) | enabled (server tool) | enabled (local fetch + Haiku) |
| Vertex AI | enabled (Claude 4.0+ only) | enabled |
| Foundry | enabled | enabled |
| Other | disabled | enabled |

---

## 4. Head-to-Head Comparison

| Dimension | HLVM | Claude Code |
|-----------|------|-------------|
| **Provider support** | 5 providers (OpenAI, Anthropic, CC, Google, Ollama) | 3 providers (firstParty, Vertex, Foundry) |
| **Native search routing** | Per-provider via execution plan | Anthropic server tool only |
| **Custom search backend** | DuckDuckGo with intent detection, prefetch, ranking | None (only uses Anthropic server tool) |
| **Page fetching** | Readability + headless Chrome fallback | HTML→markdown via turndown + Haiku summary |
| **Domain safety** | Domain filtering in search provider | Anthropic API domain blocklist preflight |
| **Preapproved domains** | None (per-tool domain filtering) | ~130 code-related domains |
| **Caching** | Custom web cache | 15-min LRU (50MB) + 5-min domain check |
| **Citation system** | Span-based (startIndex, endIndex, sourceId, confidence) | Inline markdown hyperlinks in response |
| **Source authority** | 6-class classification system | None |
| **Query intelligence** | Intent detection, query variants, comparison decomposition | None (raw query passed to server) |
| **Ranking** | BM25-like + evidence quality + optional LLM-guided | Server-side (Anthropic handles it) |
| **Usage tracking** | Lighter (per-tool budget counters) | Deep (`server_tool_use.{web_search_requests, web_fetch_requests}`) |
| **Cost tracking** | Not web-specific | `getTotalWebSearchRequests()`, per-model USD |
| **Search per-call limit** | 15 searches per run | 8 searches per tool call |
| **Fetch per-call limit** | 25 fetches per run | No explicit limit |
| **Raw URL fetch** | Dedicated `fetch_url` tool | Not separate (folded into WebFetch) |
| **Binary content** | Via web_fetch | Save to disk + attempt Haiku summary |
| **JavaScript rendering** | Headless Chrome fallback | None |
| **Code size** | ~7,900 lines | ~1,800 lines |
| **Test coverage** | Unit + E2E smoke + competitive eval | Standard tool tests |

---

## 5. What Was the Problem Before

Before the web capability work, HLVM had:

1. **Scattered routing:** No single place decided native vs. custom per provider
2. **Missing native support:** Provider-native web search wasn't injected for any provider
3. **Weak search backend:** Basic DuckDuckGo without intent detection, prefetch, or ranking
4. **No citation tracking:** No structured way to trace which passages came from which URLs
5. **No execution plan:** Routing was query-time, ad-hoc, with no session-scoped SSOT
6. **No source authority:** All results treated equally regardless of source quality
7. **No evidence extraction:** Snippets only, no passage-level retrieval from fetched pages

---

## 6. What We Accomplished

### Phase 1: Capability SSOT + Native Injection
- Built `ResolvedProviderExecutionPlan` in `tool-capabilities.ts`
- Added provider-native tool injection for OpenAI, Anthropic, Claude Code, Google
- Wired through session → SDK → orchestrator

### Phase 2: Custom Search Backend Upgrade
- DuckDuckGo backend with prefetch + BM25-like ranking + evidence extraction
- Query intent detection (docs, comparison, recency, version, release notes, reference)
- Source authority classification (6 classes)
- Deterministic + optional LLM-guided result selection

### Phase 3: Page Fetching Upgrade
- Readability library integration for article extraction
- Headless Chrome fallback for JavaScript-heavy pages
- Batch URL fetching (max 5 concurrent 3)

### Phase 4: Citation + Evidence System
- Span-based citation tracking
- Low-confidence recovery (auto-generate follow-up queries)
- Evidence-first presentation in responses

### Phase 5: Testing + Documentation
- Provider smoke tests (OpenAI, Google, mixed-platform)
- Competitive evaluation test suite
- Architecture documentation (`hlvm-web-capability-phase-summary.md`)

---

## 7. Where HLVM Stands vs CC Now

### HLVM is ahead:
- **Provider-agnostic design:** Works across 5 providers, not just Anthropic
- **Richer custom search:** Intent detection, prefetch, ranking, evidence extraction
- **Citation system:** Structured spans vs. inline markdown
- **JavaScript rendering:** Headless Chrome fallback
- **Source authority:** 6-class classification
- **Explicit capability SSOT:** Session-scoped plan, clear native/custom boundary

### CC is ahead:
- **Product telemetry:** Deep web usage tracking, cost accounting, analytics
- **Domain safety:** Centralized blocklist API, preapproved host list
- **IP protection:** Copyright-aware prompting for non-preapproved domains
- **Simplicity:** ~1,800 lines vs ~7,900 lines
- **Server-side quality:** Anthropic's server-side search is high quality by default
- **Redirect handling:** Careful same-host-only policy with user re-fetch for cross-host

### Roughly equal:
- **Caching:** Both have caching, different strategies
- **Basic search quality:** Both return usable results
- **Page fetching:** Both can fetch and parse pages (different approaches)

---

## 8. Critical Invariants (Must Preserve in HLVM)

1. **`compute` ≠ `remote_code_execute`** — Separate capabilities
2. **`web_fetch` ≠ `fetch_url`** — Different semantics (readability vs. raw)
3. **`search_web` + `web_search` = one logical capability** — Pair normalization enforced
4. **Provider-native tool calls MUST NOT execute locally** — Filtered via `getProviderExecutedToolNameSet()`
5. **Native page-read only for dedicated allowlist** — Conservative gate
6. **`remote_code_execute` disabled by default** — Explicit allowlist + native support required
7. **Session plan is SSOT for routing** — Not query-time; no secondary routing SSOT

---

## 9. Best Next Topics

If continuing web RAG work, highest-value areas:

### 9A. CC-style Web Telemetry for HLVM
Add structured usage tracking:
- `web_search_requests` counter (native + custom)
- `web_fetch_requests` counter
- Provider-grounding attribution
- Citation quality metrics
- Cost attribution per web operation

### 9B. Domain Safety Parity
HLVM lacks CC's:
- Domain blocklist preflight (Anthropic API)
- Preapproved host list for permission bypass
- IP-protection-aware prompting for non-preapproved domains
- Egress proxy detection

### 9C. Page-Read Capability Decision
Should HLVM make native page-read more aggressive?
- Currently conservative (Google `urlContext` only on dedicated allowlist)
- Could expand to other providers if semantic parity proven
- Risk: overclaiming semantics on untested providers

### 9D. MCP Web Tool Priority
How should MCP-provided web tools interact with built-in ones?
- CC's WebFetch prompt already says "prefer MCP-provided web fetch tools"
- HLVM has no explicit MCP-vs-builtin priority for web tools
- Need: priority order (provider-native > MCP > builtin custom)

### 9E. Web Evidence Normalization
Normalize a single evidence model across:
- Provider-grounded results (native search)
- Custom search results (DuckDuckGo)
- Fetched page passages
- MCP resource content

### 9F. CC Feature Adoption Candidates
From CC, worth evaluating:
- Secondary model call pattern (isolates search from main loop context)
- `max_uses: 8` per search call (prevents runaway searches)
- Feature-flagged model selection for search (Haiku vs. main)
- Binary content persistence with file path annotation

---

## 10. File Reference Quick-Look

### HLVM — Start Here
```
src/hlvm/agent/tool-capabilities.ts        # Capability SSOT, execution plan
src/hlvm/providers/native-web-tools.ts      # Provider-native tool injection
src/hlvm/agent/tools/web-tools.ts           # Custom tool implementations
src/hlvm/agent/tools/web/ddg-search-backend.ts  # DuckDuckGo orchestration
src/hlvm/agent/tools/web/query-strategy.ts  # Intent detection
src/hlvm/agent/tools/web/search-ranking.ts  # Ranking SSOT
src/hlvm/prompt/sections.ts                 # Prompt integration
docs/hlvm-web-capability-phase-summary.md   # Architecture docs
```

### Claude Code — Start Here
```
tools/WebSearchTool/WebSearchTool.ts        # Web search tool
tools/WebFetchTool/WebFetchTool.ts          # Web fetch tool
tools/WebFetchTool/utils.ts                 # Fetch core: cache, domain check, HTML→md
tools/WebFetchTool/preapproved.ts           # Preapproved domains
services/api/claude.ts                      # API: server_tool_use streaming + usage
services/api/emptyUsage.ts                  # Usage shape
constants/betas.ts                          # Beta headers
```

### Tests
```
# HLVM
tests/e2e/native-web-search-smoke.test.ts
tests/e2e/web-rag-competitive.test.ts
tests/unit/agent/tool-capabilities.test.ts

# CC
# Standard tool test patterns (not separately catalogued)
```

---

## 11. Takeover Brief (Copy-Paste for New Agent)

```
You are taking over HLVM web-search / web-RAG work.

WORKSPACES:
  HLVM:       <hlvm-repo>
  Claude Code: <claude-code-ref>

DO NOT CONFUSE:
  Web RAG  = live external search/fetch (this document)
  Memory RAG = local fact retrieval (src/hlvm/memory/)

HLVM WEB CAPABILITY SSOT:
  src/hlvm/agent/tool-capabilities.ts       — ResolvedProviderExecutionPlan
  src/hlvm/providers/native-web-tools.ts    — per-provider native tool factories
  src/hlvm/agent/engine-sdk.ts              — SDK wiring
  src/hlvm/agent/session.ts                 — plan resolution at session creation
  src/hlvm/agent/orchestrator-tool-execution.ts — native tool filtering

HLVM CUSTOM WEB STACK (~5,900 lines):
  agent/tools/web-tools.ts                  — search_web, web_fetch, fetch_url
  agent/tools/web/ddg-search-backend.ts     — DuckDuckGo orchestration
  agent/tools/web/query-strategy.ts         — intent detection
  agent/tools/web/search-ranking.ts         — BM25-like ranking
  agent/tools/web/search-result-selector.ts — deterministic + LLM-guided
  agent/tools/web/source-authority.ts       — 6-class source classification
  agent/tools/web/citation-spans.ts         — span-based citations
  agent/tools/web/html-parser.ts            — readability + structure
  agent/tools/web/headless-chrome.ts        — JS rendering fallback

KEY DESIGN:
  Session-scoped execution plan (resolved once, not per-query)
  Per-capability routing: native | custom | disabled
  Provider-native tools MUST NOT execute locally
  Conservative native gating (page-read only on allowlist)

CURRENT PROVIDER BEHAVIOR:
  OpenAI:     native search, custom fetch
  Anthropic:  native search, custom fetch
  Claude Code: native search, custom fetch
  Google:     native search, native page-read, custom fetch_url
  Ollama:     all custom

CC COMPARISON:
  CC is product/Anthropic-centric (~1,800 lines)
  WebSearchTool: secondary model call → Anthropic server tool web_search_20250305
  WebFetchTool: fetch + HTML→markdown + Haiku summarization
  Deep usage tracking: server_tool_use.{web_search_requests, web_fetch_requests}
  ~130 preapproved code domains, domain blocklist API preflight
  CC is simpler but less provider-agnostic

BEST NEXT WORK:
  1. Web telemetry (CC-style usage counters)
  2. Domain safety parity (blocklist, preapproved hosts)
  3. MCP web tool priority order
  4. Web evidence normalization across sources
  5. Page-read capability expansion decision
```
