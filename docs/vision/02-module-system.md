# 02 — The Module System

**ESM modules as AI capabilities: architecture, authoring, and composition.**

---

## Core Principle

```
ONE HQL function  →  ONE ESM module  →  ONE registry entry  →  ONE Launchpad icon  →  (optionally) ONE Hotbar shortcut
```

An HQL module (potion) is the **atomic unit of AI capability** in the HLVM
ecosystem. It encapsulates any combination of traditional code and AI
operations behind a single callable function that compiles to a standard
JavaScript ES Module.

---

## What Is a Module

A module (potion) is an HQL file that exports one or more functions. Each
exported function becomes an executable capability in the HLVM ecosystem.

### Minimal Module (3 lines)

```lisp
;; sentiment.hql
(export (defn analyze [text]
  (ai "classify sentiment as positive/negative/neutral" {data: text})))
```

Compiles to:

```javascript
// sentiment.js (ESM)
export async function analyze(text) {
  return await ai("classify sentiment as positive/negative/neutral", { data: text });
}
```

This is valid ESM JavaScript. It can be imported by any JS project, published
to any JS registry, and run by any JS runtime.

### Module with Schema (Type-Safe AI Output)

```lisp
;; sentiment.hql
(generable Sentiment {
  sentiment: (case "positive" "negative" "neutral")
  score:     {type: number min: 0 max: 1}
  keywords:  [string]})

(export (defn analyze [text]
  (ai "analyze sentiment" {data: text schema: Sentiment})))
```

The `schema` option uses native vendor constrained decoding (via AI SDK + Zod)
to guarantee the output matches the schema. The return value is a typed object,
not a string.

### Module with Agent (Full Autonomy)

```lisp
;; report-writer.hql
(export (defn write-report [topic]
  (agent "research this topic, gather data, write a comprehensive report,
          and save to ~/reports/" {data: topic})))
```

The `agent()` function runs the full HLVM ReAct loop: the LLM can call tools
(file read/write, web search, shell execution), observe results, call more
tools, and produce a final answer. This is the same engine that powers the
REPL's natural language mode.

### Module with Team (Multi-Agent Orchestration)

```lisp
;; feature-builder.hql
(export (defn build [prd]
  (agent "You are a tech lead. Read this PRD and:
          1. Break it into tasks
          2. Spawn a team (researcher, coder, tester)
          3. Assign tasks and coordinate
          4. Deliver working code with tests"
    {data: prd})))
```

Behind a single function call, the agent orchestrates an entire team using
HLVM's built-in team infrastructure (spawnTeam, spawnAgent, TaskCreate,
TaskUpdate, SendMessage).

---

## The Module Format — One File In, One File Out

Every potion is defined in a SINGLE file: `index.hql`. The `(module ...)` form
is always the first expression — metadata lives inside the code. Compiles to a
SINGLE output: `main.js` with metadata embedded as `__hlvm_meta`.

No manifest. No config. No JSON. One file in, one file out.

```
┌─── index.hql — The ONE file ─────────────────────────────────────────────┐
│                                                                           │
│  (module                                     ;; FIRST FORM (metadata)    │
│    {name:        "Sentiment Analyzer"                                     │
│     description: "Classify text sentiment with confidence and keywords"  │
│     version:     "1.2.0"                                                  │
│     author:      "jane"                                                   │
│     icon:        "face.smiling"              ;; SF Symbol name           │
│     category:    "data-analysis"                                          │
│     params:      [{name: "text"                                           │
│                    type: "string"                                          │
│                    label: "Text to analyze"                                │
│                    required: true}]})                                      │
│                                                                           │
│  ;; That's it for metadata. No separate manifest needed.                 │
│  ;; Effect and permissions are AUTO-DETECTED by the compiler.            │
│  ;; The compiler sees ai() calls → marks effect: "ai"                    │
│  ;; The compiler sees network usage → marks permissions accordingly      │
│                                                                           │
│  (generable Sentiment {                                                   │
│    sentiment: (case "positive" "negative" "neutral")                      │
│    score:     {type: number min: 0 max: 1}                                │
│    keywords:  [string]})                                                  │
│                                                                           │
│  (export (defn analyze [text]                ;; THE CODE                 │
│    (ai "analyze sentiment" {data: text schema: Sentiment})))             │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

What the compiler produces from this single file:

```
┌─── Compilation: One File In → One File Out ──────────────────────────────┐
│                                                                           │
│  INPUT:   index.hql                                                       │
│  OUTPUT:  main.js  (+ main.js.map for debugging)                         │
│                                                                           │
│  main.js is a standard ESM JavaScript module that contains:               │
│                                                                           │
│    // The compiled code                                                   │
│    export async function analyze(text) {                                  │
│      return await ai("analyze sentiment", { data: text, schema: ... });  │
│    }                                                                      │
│                                                                           │
│    // The embedded metadata (from (module ...) form + compiler analysis)  │
│    export const __hlvm_meta = {                                           │
│      name: "Sentiment Analyzer",                                          │
│      description: "Classify text sentiment with confidence and keywords",│
│      version: "1.2.0",                                                    │
│      author: "jane",                                                      │
│      icon: "face.smiling",                                                │
│      category: "data-analysis",                                           │
│      effect: "ai",                  // ← auto-detected by compiler      │
│      permissions: ["network"],       // ← auto-detected                  │
│      params: [{ name: "text", type: "string",                            │
│                 label: "Text to analyze", required: true }]              │
│    };                                                                     │
│                                                                           │
│  KEY INSIGHT:                                                             │
│  - User writes ONE file (index.hql)                                       │
│  - Compiler produces ONE file (main.js) — everything bundled inside      │
│  - NO separate manifest, NO hlvm.json, NO config file                    │
│  - GUI reads __hlvm_meta directly from the ESM module                    │
│  - Effect/permissions are inferred, not declared                          │
│  - The compiled JS IS the module. Self-describing. Self-contained.       │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### (module ...) Form Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable display name |
| `description` | string | yes | One-line description |
| `version` | semver | yes | Module version |
| `author` | string | yes | Author identifier |
| `icon` | string | yes | SF Symbol name (macOS native icons) |
| `category` | string | yes | Registry category |
| `params` | Param[] | no | Input parameters the module accepts |

Note: `effect` and `permissions` are **not declared by the author**. They are
auto-detected by the compiler's effect checker at compile time.

### Effect Classification

The compiler's effect checker infers the effect classification from the code:

```
┌─────────────┬──────────────────┬───────────────────────────────────┐
│ Effect      │ GUI Badge        │ Meaning                           │
├─────────────┼──────────────────┼───────────────────────────────────┤
│ "pure"      │ Green  ● Safe    │ No side effects. Deterministic.   │
│             │                  │ Can be cached. No permissions.    │
├─────────────┼──────────────────┼───────────────────────────────────┤
│ "ai"        │ Yellow ● AI      │ Makes LLM calls. Needs network.  │
│             │                  │ Non-deterministic output.         │
├─────────────┼──────────────────┼───────────────────────────────────┤
│ "agent"     │ Red    ● Agent   │ Full system access. Can read/     │
│             │                  │ write files, run commands, browse │
│             │                  │ web. Long-running.                │
└─────────────┴──────────────────┴───────────────────────────────────┘
```

This classification is derived from HQL's effect system at compile time:
- `fx` functions → `"pure"`
- `fn` functions that call `ai()` → `"ai"`
- `fn` functions that call `agent()` → `"agent"`

The author never writes `effect: "agent"` — the compiler detects it.

### Permission Types

```
┌──────────────────┬──────────────────────────────────────────────┐
│ Permission       │ What it allows                                │
├──────────────────┼──────────────────────────────────────────────┤
│ "network"        │ HTTP requests, LLM API calls                 │
│ "filesystem"     │ Read/write files on disk                     │
│ "shell"          │ Execute shell commands                       │
│ "git"            │ Git operations                               │
│ "mcp"            │ Connect to MCP servers                       │
└──────────────────┴──────────────────────────────────────────────┘
```

Permissions are auto-detected by the compiler. The author does not declare them.

### Input Parameters

Modules declare input parameters inside the `(module ...)` form. The GUI
renders these as a form when the user clicks the potion icon:

```lisp
(module
  {name:        "Price Tracker"
   description: "Monitor competitor pricing pages"
   version:     "1.0.0"
   author:      "jane"
   icon:        "chart.line.uptrend.xyaxis"
   category:    "monitoring"
   params:      [{name:        "url"
                  type:        "string"
                  label:       "Target URL"
                  placeholder: "https://competitor.com/pricing"
                  required:    true}
                 {name:    "frequency"
                  type:    "select"
                  label:   "Check frequency"
                  options: ["hourly" "daily" "weekly"]
                  default: "daily"}]})

(export (defn track [url frequency]
  (agent (str "Monitor " url " every " frequency
              ", alert me when prices change")
    {data: {url: url frequency: frequency}})))
```

When the user clicks the potion icon, the GUI shows this form. After filling it
in, the module runs with these values as arguments.

---

## Module Composition

Because modules compile to standard ESM, they compose naturally through
imports:

```
┌──────────────────────────────────────────────────────────────┐
│                   Module Composition                         │
│                                                              │
│   extract.hql          analyze.hql          report.hql       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ export       │    │ import       │    │ import       │   │
│  │  (defn       │◄───│  {extract}   │◄───│  {analyze}   │   │
│  │   extract    │    │              │    │              │   │
│  │   [url]      │    │ export       │    │ export       │   │
│  │   (agent     │    │  (defn       │    │  (defn       │   │
│  │    "scrape"  │    │   analyze    │    │   report     │   │
│  │    {data:    │    │   [url]      │    │   [url]      │   │
│  │     url}))   │    │   (ai "find  │    │   (agent     │   │
│  │              │    │    trends"   │    │    "write    │   │
│  │              │    │    {data:    │    │     report"  │   │
│  │              │    │     (await   │    │    {data:    │   │
│  │              │    │      (extract│    │     (await   │   │
│  │              │    │       url))} │    │      (analyze│   │
│  │              │    │    ))       │    │       url))} │   │
│  │              │    │             │    │    ))        │   │
│  └──────────────┘    └─────────────┘    └─────────────┘   │
│                                                              │
│  Each can be a separate Launchpad icon.                      │
│  Or user just clicks "report" and it cascades.               │
│                                                              │
│  This is CRAFTING: combine small capabilities into           │
│  bigger capabilities. Like combining potions in Diablo.      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Cross-Registry Imports

Because the output is standard ESM and runs on Deno, modules can import from
anywhere:

```lisp
;; Import from another HLVM potion (on the registry)
(import {extract} from "hlvm:@jane/extractor")

;; Import from npm
(import {chart} from "npm:chart.js")

;; Import from JSR
(import {parse} from "jsr:@std/csv")

;; Import from HTTP
(import {utils} from "https://example.com/lib/utils.js")
```

This means HLVM modules have access to the **entire JavaScript ecosystem**.
Every npm package, every JSR package, every HTTP-hosted module. The limitation
is JavaScript — which is none.

---

## Module Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                        Module Lifecycle                          │
│                                                                 │
│  1. AUTHOR                                                      │
│     ┌──────────────┐                                            │
│     │ Write HQL    │  Author writes index.hql                   │
│     │ (3-10 lines) │  with (module ...) form + ai/agent code    │
│     └──────┬───────┘                                            │
│            │                                                    │
│  2. COMPILE                                                     │
│     ┌──────┴───────┐                                            │
│     │ hlvm build   │  index.hql → main.js (code + __hlvm_meta)  │
│     │              │  Effect + permissions auto-detected         │
│     │              │  No separate manifest generated             │
│     └──────┬───────┘                                            │
│            │                                                    │
│  3. DEPLOY                                                      │
│     ┌──────┴───────┐                                            │
│     │ hlvm deploy  │  One command:                               │
│     │              │  (default) install locally                   │
│     │              │  --jsr → publish to JSR                     │
│     │              │  --npm → publish to npm                     │
│     │              │  No custom registry needed                   │
│     └──────┬───────┘                                            │
│            │                                                    │
│  4. DISCOVER                                                    │
│     ┌──────┴───────┐                                            │
│     │ User browses │  Module Store GUI in HLVM macOS app        │
│     │ or searches  │  Search, browse categories, see trending   │
│     │              │  CLI: hlvm search <query>                   │
│     └──────┬───────┘                                            │
│            │                                                    │
│  5. INSTALL                                                     │
│     ┌──────┴───────┐                                            │
│     │ Click        │  GUI: "Install" button                     │
│     │ Install      │  CLI: hlvm install jsr:@jane/sentiment     │
│     │              │  → downloads main.js from author's hosting  │
│     │              │  → stores in ~/.hlvm/modules/              │
│     │              │  → reads __hlvm_meta from the module       │
│     │              │  → appears in LAUNCHPAD (all installed)    │
│     └──────┬───────┘                                            │
│            │                                                    │
│  6. PIN (optional)                                              │
│     ┌──────┴───────┐                                            │
│     │ Pin to       │  User pins potion from Launchpad to Hotbar │
│     │ Hotbar       │  Or assigns a keyboard shortcut            │
│     │              │  Hotbar = quick-access subset of Launchpad  │
│     └──────┬───────┘                                            │
│            │                                                    │
│  7. EXECUTE                                                     │
│     ┌──────┴───────┐                                            │
│     │ Click icon   │  From Launchpad grid OR Hotbar shortcut    │
│     │              │  Click → GUI shows param form (if any)     │
│     │              │  → hlvm run @jane/sentiment --text "..."   │
│     │              │  → result displayed in GUI                 │
│     └──────┬───────┘                                            │
│            │                                                    │
│  8. UPDATE                                                      │
│     ┌──────┴───────┐                                            │
│     │ Author       │  Author pushes new version                 │
│     │ deploys v2   │  Users see update badge on icon            │
│     │              │  One-click update                          │
│     └──────────────┘                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Directory Structure

A potion on disk (after `hlvm build`):

```
my-module/
├── index.hql              ← HQL source (the ONE file the author writes)
└── dist/
    ├── main.js             ← Compiled ESM (code + __hlvm_meta bundled)
    └── main.js.map         ← Source map (for debugging)
```

No `hlvm.json`. No separate manifest. The compiled `main.js` IS the module —
self-describing via `__hlvm_meta`.

After installation on a user's machine:

```
~/.hlvm/modules/
├── @jane/
│   └── sentiment/
│       ├── 1.2.0/
│       │   └── main.js         ← The ONE compiled file (code + __hlvm_meta)
│       └── current → 1.2.0/    ← Symlink to active version
├── @bob/
│   └── report-writer/
│       ├── 3.0.1/
│       │   └── main.js
│       └── current → 3.0.1/
├── index.json                  ← Local module index (metadata cache)
└── launchpad.json              ← Launchpad state (all installed potions)
```

---

## The Launchpad

The Launchpad is the **complete inventory** of all installed potions. Every
potion that has been installed — whether from the registry or locally — appears
here. It is the **superset** of the Hotbar.

```
┌─── Launchpad (ALL installed potions) ─────────────────────────┐
│                                                                │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
│  │Sent│ │Rept│ │Code│ │Srch│ │Anlz│ │Test│ │Dply│ │Mntr│   │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘   │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                         │
│  │Git │ │Wiki│ │Mail│ │Data│ │Imgn│                          │
│  └────┘ └────┘ └────┘ └────┘ └────┘                          │
│                                                                │
│  Every installed potion lives here. Search, filter, browse.   │
│  Right-click any icon → "Pin to Hotbar" or "Assign Shortcut" │
│                                                                │
│  Store → Install → Launchpad → pin/shortcut → Hotbar          │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

The Launchpad is where the user goes to:
- Browse all installed potions
- Search by name, category, or effect
- Launch any potion (click the icon)
- Manage updates and versions
- Pin potions to the Hotbar for quick access

---

## The Hotbar Configuration

The Hotbar is the user's **quick-access bar** — a **subset** of the Launchpad
containing only potions the user has explicitly pinned or assigned shortcuts to.

**Launchpad = ALL installed potions (superset).
Hotbar = only pinned/shortcut potions (subset).**

Configuration is a simple JSON file:

```json
{
  "slots": [
    { "module": "@jane/sentiment",       "position": 0 },
    { "module": "@bob/report-writer",    "position": 1 },
    { "module": "@hlvm/code-reviewer",   "position": 2 },
    { "module": "@hlvm/web-researcher",  "position": 3 }
  ],
  "profiles": {
    "default": [0, 1, 2, 3],
    "research": [3, 4, 5, 6],
    "coding": [2, 7, 8, 9]
  }
}
```

Users can have multiple Hotbar profiles (loadouts) for different workflows,
switchable from the GUI:

```
My Monday hotbar:
┌────┐ ┌────┐ ┌────┐ ┌────┐
│Rept│ │Mon │ │Srch│ │Anlz│
└────┘ └────┘ └────┘ └────┘

My Focus hotbar:
┌────┐ ┌────┐ ┌────┐ ┌────┐
│Code│ │Test│ │Dply│ │Mntr│
└────┘ └────┘ └────┘ └────┘
```

Drag icons from Launchpad to Hotbar. Drag icons out to unpin.
Exactly like equipping skills in Diablo.
