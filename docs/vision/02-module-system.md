# 02 — The Module System

**ESM modules as AI capabilities: architecture, authoring, and composition.**

---

## Core Principle

```
ONE HQL function  →  ONE ESM module  →  ONE Store entry  →  ONE Hotbar icon  →  ONE click
```

An HQL module is the **atomic unit of AI capability** in the HLVM ecosystem.
It encapsulates any combination of traditional code and AI operations behind a
single callable function that compiles to a standard JavaScript ES Module.

---

## What Is a Module

A module is an HQL file that exports one or more functions. Each exported
function becomes an executable capability in the HLVM ecosystem.

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

## Module Manifest (hlvm.json)

Every module includes a manifest that describes it to the HLVM platform and
Module Store. This file sits alongside the compiled ESM output.

```json
{
  "name": "Sentiment Analyzer",
  "description": "Classify text sentiment with confidence score and keywords",
  "version": "1.2.0",
  "author": "jane",
  "icon": "face.smiling",
  "effect": "ai",
  "permissions": ["network"],
  "category": "data-analysis",
  "params": [
    {
      "name": "text",
      "type": "string",
      "label": "Text to analyze",
      "required": true
    }
  ],
  "entry": "./sentiment.js",
  "source": "hql"
}
```

### Manifest Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable display name |
| `description` | string | yes | One-line description |
| `version` | semver | yes | Module version |
| `author` | string | yes | Author identifier |
| `icon` | string | yes | SF Symbol name (macOS native icons) |
| `effect` | enum | yes | Safety classification (see below) |
| `permissions` | string[] | yes | Required permissions |
| `category` | string | yes | Store category |
| `params` | Param[] | no | Input parameters the module accepts |
| `entry` | string | yes | Path to main ESM file |
| `source` | string | no | `"hql"` or `"js"` — authoring language |

### Effect Classification

The `effect` field maps directly from HQL's compile-time effect system:

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

### Input Parameters

Modules can declare input parameters that the GUI renders as a form:

```json
"params": [
  {
    "name": "url",
    "type": "string",
    "label": "Target URL",
    "placeholder": "https://competitor.com/pricing",
    "required": true
  },
  {
    "name": "frequency",
    "type": "select",
    "label": "Check frequency",
    "options": ["hourly", "daily", "weekly"],
    "default": "daily"
  }
]
```

When the user clicks the module icon, the GUI shows this form. After filling it
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
│  Each can be a separate Hotbar icon.                         │
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
;; Import from another HLVM module (on the Store)
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
│     │ Write HQL    │  Author writes sentiment.hql               │
│     │ (3-10 lines) │  with ai(), agent(), or pure code          │
│     └──────┬───────┘                                            │
│            │                                                    │
│  2. COMPILE                                                     │
│     ┌──────┴───────┐                                            │
│     │ hlvm compile │  HQL → ESM JavaScript                      │
│     │              │  + generates hlvm.json manifest             │
│     └──────┬───────┘                                            │
│            │                                                    │
│  3. DEPLOY                                                      │
│     ┌──────┴───────┐                                            │
│     │ hlvm deploy  │  One command:                               │
│     │              │  → uploads ESM to Module Store              │
│     │              │  → registers manifest + metadata            │
│     │              │  → now searchable by all users              │
│     └──────┬───────┘                                            │
│            │                                                    │
│  4. DISCOVER                                                    │
│     ┌──────┴───────┐                                            │
│     │ User browses │  Module Store GUI in HLVM macOS app        │
│     │ or searches  │  Search, browse categories, see trending   │
│     └──────┬───────┘                                            │
│            │                                                    │
│  5. INSTALL                                                     │
│     ┌──────┴───────┐                                            │
│     │ Click        │  GUI: "Install" button                     │
│     │ Install      │  CLI: hlvm install @jane/sentiment         │
│     │              │  → downloads ESM from Store                │
│     │              │  → stores in ~/.hlvm/modules/              │
│     └──────┬───────┘                                            │
│            │                                                    │
│  6. EXECUTE                                                     │
│     ┌──────┴───────┐                                            │
│     │ Click icon   │  Module icon appears on Hotbar             │
│     │ on Hotbar    │  Click → GUI shows param form (if any)     │
│     │              │  → hlvm run @jane/sentiment --text "..."   │
│     │              │  → result displayed in GUI                 │
│     └──────┬───────┘                                            │
│            │                                                    │
│  7. UPDATE                                                      │
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

A module on disk (after `hlvm compile`):

```
my-module/
├── src/
│   └── main.hql           ← HQL source
├── dist/
│   ├── main.js             ← Compiled ESM (the actual module)
│   └── main.js.map         ← Source map (for debugging)
├── hlvm.json               ← Module manifest
├── README.md               ← Description (shown in Store)
└── deno.json               ← Deno config (dependencies, if any)
```

After installation on a user's machine:

```
~/.hlvm/modules/
├── @jane/
│   └── sentiment/
│       ├── 1.2.0/
│       │   ├── main.js         ← The ESM module
│       │   └── hlvm.json       ← Manifest
│       └── current → 1.2.0/    ← Symlink to active version
├── @bob/
│   └── report-writer/
│       ├── 3.0.1/
│       │   ├── main.js
│       │   └── hlvm.json
│       └── current → 3.0.1/
└── .hotbar.json                ← Which modules are on the Hotbar + order
```

---

## The Hotbar Configuration

The Hotbar is the user's equipped set of modules. Configuration is a simple
JSON file:

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
│ 📝 │ │ 📊 │ │ 🔍 │ │ 📈 │
│Rept│ │Mon │ │Srch│ │Anlz│
└────┘ └────┘ └────┘ └────┘

My Focus hotbar:
┌────┐ ┌────┐ ┌────┐ ┌────┐
│ 💻 │ │ 🧪 │ │ 🚀 │ │ 📡 │
│Code│ │Test│ │Dply│ │Mntr│
└────┘ └────┘ └────┘ └────┘
```

Drag icons in, drag icons out. Exactly like equipping skills in Diablo.
