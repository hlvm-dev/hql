# HLVM Potion System — Complete Vision

> **One document to rule them all.**
> Consolidated from the original vision docs (01-story, 02-module-system, 03-module-store, 04-user-journeys, 05-competitive-analysis, 07-daily-driver-scenarios, 08-full-execution-pipeline).

---

## Table of Contents

1. [The Story — Vision & Philosophy](#01--the-story)
2. [The Module System](#02--the-module-system)
3. [The Module Store — Distribution & Discovery](#03--the-module-store)
4. [User Journeys](#04--user-journeys)
5. [Competitive Analysis](#05--competitive-analysis)
6. [Daily Driver Scenarios](#07--daily-driver-scenarios)
7. [Full Execution Pipeline](#08--full-execution-pipeline)

---

# 01 — The Full Story

**Why HLVM exists. What it becomes. Why it matters.**

---

## The Problem

It is 2026. AI can summarize documents, analyze data, write code, search the
web, manage files, coordinate multi-step workflows, and even orchestrate teams
of agents. The raw capability exists.

But there is a massive gap between **"AI can do this"** and **"I have this
automated on my computer."**

Today, crossing that gap looks like this:

```
"I want AI to monitor competitor pricing"

  Step 1:  Learn Python                          (hours)
  Step 2:  pip install langchain crewai scrapy    (minutes, but fragile)
  Step 3:  Write 200+ lines of orchestration      (hours)
  Step 4:  Handle API keys, errors, retries       (hours)
  Step 5:  Run from terminal, manage scheduling   (ongoing)
  Step 6:  Debug when it breaks at 3am            (ongoing)

  Total: 2-3 days of skilled developer work
  Audience: developers only
```

For non-developers, the gap is infinite. They use ChatGPT manually, every time,
copy-pasting results. No automation. No reuse. No composition.

For developers, the gap is annoying enough that most don't bother. They use AI
in chat form and do the rest manually.

**The gap is not capability. The gap is delivery.**

---

## The Vision

HLVM collapses the gap to zero:

```
"I want AI to monitor competitor pricing"

  Step 1:  Search "monitor" in HLVM Spotlight     (2 seconds)
  Step 2:  Click Install                           (1 click)
  Step 3:  Click the module icon in Launchpad       (1 click)
  Step 4:  Enter competitor URL when prompted      (5 seconds)
  Step 5:  Done.

  Total: 30 seconds
  Audience: anyone with a Mac
```

Behind that one click, the module might be doing anything: a single AI call, a
multi-step pipeline, a full agent team that scrapes websites, analyzes trends,
writes a report, and saves it to your ~/reports/ folder. The user doesn't know.
The user doesn't care. They click, they get results.

---

## What HLVM Becomes

HLVM is **the platform where AI capabilities are authored, shared, and
consumed.**

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   AUTHOR              SHARE              CONSUME            │
│                                                             │
│   Write HQL     →    Deploy to     →    Click icon in       │
│   (3-10 lines)       Registry           macOS Launchpad     │
│                      (1 command)        (1 click)           │
│                                                             │
│   Human or AI        JSR / npm          Native macOS        │
│   can author         (existing          GUI                 │
│                       registries)       for all             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Three roles in the ecosystem:

### Authors

Write HQL modules that encapsulate AI capabilities. A module is a function
that can contain anything: `ai()` calls, `agent()` loops, team orchestration,
traditional algorithms, or any combination. Deploy with one command.

### Consumers

Browse the Registry from the HLVM macOS app. Search, discover trending
modules, read reviews, install with one click. Modules appear in the Launchpad
as clickable icons. Pin favorites to the Hotbar for quick access. Click to run.
Drag to rearrange. Remove what you don't need.

### The Platform

HLVM itself: the binary that compiles HQL, runs modules, provides the agent
engine, manages teams, handles permissions, connects to AI providers, and
exposes everything through a native macOS GUI.

---

## The Diablo Hotbar Mental Model

This is intentional, not just an analogy.

In Diablo or Lineage, you are a character fighting monsters. You have a hotbar
of skills and potions. Each item does something powerful. You equip items for
different encounters. You find, craft, and trade items.

```
Diablo                              HLVM
──────                              ────
Character                           You (developer, analyst, writer, anyone)
Monsters / Boss                     Complexity (tasks, data, deadlines)
Skills on hotbar (1-9 keys)         AI modules on Hotbar (click)
Equip / unequip skills              Drag modules in / out of Hotbar
Skill does AoE damage               Module runs full agent team
Craft new skills                    Author new modules (or have AI do it)
Find loot / rare items              Discover modules in the Store
Trade items with others             Share modules via the Store
Skill loadout per dungeon           Hotbar config per workflow
```

The UI is NOT a game. It is macOS native — clean, minimal, professional. The
Hotbar looks like macOS Dock or Genie. The Registry browser looks like Mac App
Store.

> **Note:** The Hotbar is a subset of the Launchpad. All installed modules
> appear in the Launchpad (full inventory). The Hotbar contains only the modules
> the user has pinned or assigned shortcuts to. Flow: Registry (browse) -> Install
> -> Launchpad -> pin/shortcut -> Hotbar.

But the **mental model** is the game: you equip yourself with AI capabilities
to fight your daily work. Each module is a weapon. The Store is the marketplace
where you find better weapons. Authors are the crafters.

---

## The Atomic Unit: ONE Function = ONE Module = ONE Click

This is the core design principle. Everything reduces to:

```
ONE HQL function
      │
      │  compiles to
      ▼
ONE ESM module (standard JavaScript)
      │
      │  deployed to
      ▼
ONE entry in the Registry
      │
      │  installed as
      ▼
ONE icon in the Launchpad
      │
      │  executed with
      ▼
ONE click → complexity killed
```

What makes this function special: it can contain **BOTH** traditional
programming AND AI inside. It is not just code. It is not just a prompt. It is
code + AI fused into one callable unit.

```lisp
;; Simple: single AI call
(export (defn summarize [text]
  (ai "summarize in 3 bullets" {data: text})))

;; Medium: multi-step pipeline
(export (defn weekly-report []
  (let [data   (agent "pull this week's metrics from our APIs")
        draft  (ai "write executive summary" {data: data})
        report (agent (str "save as reports/week-" (now) ".md") {data: draft})]
    report)))

;; Complex: full autonomous team
(export (defn build-feature [prd]
  (agent "form a team, plan the work, implement, test, deliver" {data: prd})))
```

All three compile to ESM. All three become clickable icons. All three take one
click to execute. The user does not know or care what is inside. Like a Diablo
health potion — you do not open it to see the alchemy recipe. You drink it.
It works.

---

## Why HQL (Not Just JavaScript)

HQL compiles to JavaScript. So why not write modules in JavaScript directly?

### 1. Conciseness

An AI module in HQL is 3-10 lines. The equivalent JavaScript with imports,
error handling, and async boilerplate is 30-50 lines.

```lisp
;; HQL: 3 lines
(export (defn analyze [text]
  (ai "classify sentiment" {data: text schema: Sentiment})))
```

```javascript
// JavaScript: ~20 lines
import { ai } from "@hlvm/runtime";
import { Sentiment } from "./schemas.js";

export async function analyze(text) {
  try {
    const result = await ai("classify sentiment", {
      data: text,
      schema: Sentiment
    });
    return result;
  } catch (e) {
    throw new Error(`Analysis failed: ${e.message}`);
  }
}
```

### 2. AI and Agent Are First-Class

`ai()` and `agent()` are globals in HQL. No imports. No setup. Just call them.

### 3. Effect System = Safety Classification

HQL's effect system (`fx` for pure, `fn` for impure) provides compile-time
safety classification that the GUI uses to show permission badges:

```lisp
;; Pure module — green badge, no permissions needed
(export (fx compute [data]
  (map (fn [x] (* x 2)) data)))

;; AI module — yellow badge, needs network
(export (defn summarize [text]
  (ai "summarize" {data: text})))

;; Agent module — red badge, needs full system access
(export (defn deploy [spec]
  (agent "implement and deploy" {data: spec})))
```

### 4. Composable via Standard ESM

HQL modules compile to standard ESM. They can import from each other, from npm,
from JSR, from any HTTP URL. Full JavaScript ecosystem access.

```lisp
(import {extract} from "./extract.hql")
(import {analyze} from "./analyze.hql")

(export (defn full-report [url]
  (let [data     (await (extract url))
        analysis (await (analyze data))]
    (agent "write report and save" {data: analysis}))))
```

### 5. Macros for Domain Abstraction

HQL macros can create domain-specific patterns that abstract common AI
workflows:

```lisp
;; A macro could let you write:
(ai-pipeline sentiment-report
  (extract url)
  (analyze {schema: Sentiment})
  (report "save to ~/reports/"))
```

### 6. Output Is Platform-Agnostic

The output is standard ESM JavaScript. It runs anywhere a JS VM runs. Not
locked to macOS, not locked to Deno, not locked to HLVM. The module can be
imported by any JavaScript project.

---

## What Makes This Revolutionary

No single piece is new:

```
AI callable from code          → Every language can do this
Agent teams                    → CrewAI, AutoGen, LangChain
Native macOS GUI               → Every Mac app
One-click automation           → Apple Shortcuts, Raycast
Composable modules             → npm, ESM
Code-first authoring           → Every IDE
Central package registry       → npm, PyPI, crates.io
```

The revolution is the **integration**. Nobody has combined ALL of these:

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Real programming language (HQL)                             │
│    + AI primitives as first-class (ai, agent)                │
│    + Agent team orchestration built-in                       │
│    + Compiles to standard portable format (ESM)              │
│    + JSR/npm for sharing (no custom registry)                │
│    + Native macOS GUI for one-click execution                │
│    + Full local system access (files, web, shell, git)       │
│    + Effect system for safety classification                 │
│    + Any LLM provider (Ollama, OpenAI, Anthropic, Google)    │
│    + Memory system for persistent context                    │
│                                                              │
│  = HLVM                                                      │
│                                                              │
│  Nobody else has this stack.                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The revolution is the **complete elimination of friction** from idea to
automated AI workflow:

```
TODAY (2026):                           HLVM:

  "I want to monitor competitors"       "I want to monitor competitors"
         │                                      │
         ├── Learn Python                       ├── Search in Spotlight
         ├── Install dependencies               ├── Click Install
         ├── Write 200 lines                    ├── Click the icon
         ├── Handle errors                      └── Done. 30 seconds.
         ├── Run from terminal
         └── 2-3 days

  Developer-only.                       Anyone with a Mac.
  Fragile.                              Maintained by community.
  Local-only.                           Shared via Registry.
  No reuse.                             One-click reuse.
```

---

## The Ecosystem Flywheel

The Module Registry is not a "nice to have." It IS the product. Without it,
HLVM is a local scripting tool. With it, HLVM is a platform. Modules are
published to existing registries (JSR, npm). No custom registry to build or
maintain. HLVM piggybacks on ecosystems that already work.

```
Local tool:     You write, you use.          Value = linear.
Platform:       You write, everyone uses.    Value = exponential.
```

The flywheel:

```
    Author publishes module
            │
            ▼
    Module appears in Registry ──────────► Users discover it
            ▲                                    │
            │                                    ▼
    More authors join                    Users install, use, star
    because audience exists                      │
            ▲                                    ▼
            │                            Module gains visibility
            │                            (trending, featured)
            │                                    │
            └────────────────────────────────────┘
                     Network effect
```

Every successful ecosystem has a central registry:

```
Language/Tool        Central Registry        Without it?
─────────────       ─────────────────       ────────────────────
Node.js         →   NPM                    Just another runtime
Python          →   PyPI                   Just another language
Ruby            →   RubyGems               Just another language
Docker          →   Docker Hub             Just another VM tool
iOS             →   App Store              Just another phone
VS Code         →   Extension Marketplace  Just another editor

HLVM            →   JSR + npm              Just another AI tool
                    (existing ecosystems)  (dead on arrival)
```

**NPM made Node.js. Not the other way around.** The registry is the moat.

---

## The PRD-to-Delivery Vision (Ultimate Goal)

The most extreme version of the HLVM vision:

```
Step 1:  Human writes a PRD (or even a single sentence)
         "I need a tool that monitors my competitors' pricing"

Step 2:  Clicks "Build" in HLVM GUI

Step 3:  HLVM's meta-orchestrator (lead agent) reads the PRD

Step 4:  Creates a team: researcher, coder, tester agents

Step 5:  Team collaborates using existing infrastructure:
         spawnTeam, spawnAgent, TaskCreate, SendMessage

Step 6:  Output: a new HQL module that DOES the thing

Step 7:  Module appears in Launchpad (pin to Hotbar for quick access)

Step 8:  Now user clicks THAT module whenever they want to
         monitor competitor pricing
```

**AI builds AI capabilities. The platform consumes its own output.** The HQL
module is the unit of currency — authored by humans OR by AI, compiled to ESM,
shared through the Registry, executed on demand through the GUI.

---

## What Matters Most

In priority order:

### 1. Module Publishing (JSR + npm)

Without this, nothing else matters. No sharing = no ecosystem = no network
effect = no PMF. This is the #1 priority.

### 2. The Launchpad / Hotbar / GUI Integration

Modules must be one-click executable from the macOS GUI. The friction from
"installed module" to "running module" must be zero. Installed modules appear
in the Launchpad; users pin favorites to the Hotbar.

### 3. HQL Authoring Experience

Writing a module must be trivially easy. 3-10 lines for common cases. `ai()`
and `agent()` as globals. No boilerplate.

### 4. The Deploy Pipeline

`hlvm deploy` must be one command that handles everything: compile and deliver.
`hlvm deploy` for local, `hlvm deploy --jsr` for JSR, `hlvm deploy --npm` for
npm. Zero friction for authors.

### 5. Trust and Safety Model

Effect-system-driven permission classification. Users must know what a module
can do before they install it. Verified badges for reviewed modules.

### 6. Meta-Orchestrator (AI-Authored Modules)

The lead agent that can read a high-level goal (PRD) and autonomously produce
a working HQL module. This closes the loop: AI builds AI capabilities.

---

## What Exists Today

HLVM already has approximately 90% of the infrastructure:

```
EXISTS:
  ✓  HQL compiler (→ ESM)
  ✓  ai() function (single LLM call with schema enforcement)
  ✓  agent() function (full ReAct loop with tools)
  ✓  Agent team system (spawnTeam, spawnAgent, TaskCreate, SendMessage)
  ✓  Multi-provider support (Ollama, OpenAI, Anthropic, Google)
  ✓  Tool system (file, web, shell, git, MCP)
  ✓  Memory system (SQLite/FTS5, persistent across sessions)
  ✓  Effect system (Pure/Impure compile-time classification)
  ✓  macOS GUI app (Spotlight, Chat, Hotbar, Settings)
  ✓  Code-first architecture (binary + thin GUI shell)
  ✓  Async HOFs (asyncMap, concurrentMap, asyncFilter, etc.)

MISSING:
  ✗  hlvm deploy command (local + JSR/npm publishing)
  ✗  Module discovery via JSR/npm search
  ✗  Registry browser GUI view in macOS app
  ✗  Module manifest via (module ...) form + __hlvm_meta
  ✗  Module → Launchpad → Hotbar pin pipeline
  ✗  Permission model for installed modules
  ✗  Meta-orchestrator lead agent
  ✗  Module packaging metadata (icon, description, params)
```

The work is primarily **platform engineering and ecosystem building**, not
language design. HQL is already sufficient for authoring AI capabilities.
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
# 03 — The Module Store

**Distribution via JSR and npm: design, requirements, trust model, and flywheel.**

---

## Why Easy Distribution Is Critical (Not Optional)

Without easy distribution:

```
+----------------------------------------------+
|  User writes HQL module                      |
|  User uses it locally                        |
|  User shares it... how?                      |
|                                              |
|  "Hey, I made a cool module"                 |
|  "Cool, how do I get it?"                    |
|  "Clone my GitHub repo, then run..."         |
|  "Never mind."                               |
|                                              |
|  DEAD. No ecosystem. No network effect.      |
|  Just a local scripting tool.                |
|  Glorified bash alias.                       |
+----------------------------------------------+
```

With distribution via existing registries:

```
+----------------------------------------------+
|  User writes HQL module                      |
|  $ hlvm deploy --jsr                         |
|  Module appears on JSR for ALL users         |
|                                              |
|  Other users search -> install -> use ->     |
|  star -> more users find it -> author        |
|  writes more -> ecosystem grows ->           |
|  more users join ->                          |
|                                              |
|  NETWORK EFFECT. Flywheel.                   |
|  This is how npm, Homebrew, Docker Hub       |
|  all became dominant.                        |
+----------------------------------------------+
```

The relationship:

```
Local tool:     You write, you use.          Value = linear.
Platform:       You write, everyone uses.    Value = exponential.
```

Every successful developer ecosystem has a central registry:

```
Platform             Registry               Without it?
--------            ---------              ------------------
Node.js         ->   NPM                   Just another runtime
Python          ->   PyPI                  Just another language
Ruby            ->   RubyGems              Just another language
Rust            ->   crates.io             Just another language
Docker          ->   Docker Hub            Just another VM tool
iOS             ->   App Store             Just another phone
VS Code         ->   Extension Market      Just another editor
Deno            ->   JSR                   Just another runtime

HLVM            ->   JSR + npm             Just another AI tool
                     (existing ecosystems)
```

**NPM made Node.js dominant. Not the other way around.** The registry IS the
moat. It IS the product.

But a registry does NOT require custom infrastructure. JSR and npm already
exist, already work, already have auth, CDN, search, versioning, and millions
of users. HLVM piggybacks on these ecosystems instead of building its own.

---

## Architecture Overview

```
+-------------------------------------------------------------------------+
|               HLVM Module Distribution (No Custom Registry)             |
|                                                                         |
|  Authors publish to existing registries. HLVM reads from them.          |
|                                                                         |
|  +----------------+                           +----------------+        |
|  |  hlvm deploy   |                           |  hlvm install  |        |
|  |  --jsr / --npm |                           |  jsr:@author/X |        |
|  |  (author)      |                           |  npm:@author/X |        |
|  |                |                           |  (user)        |        |
|  |  1. Compile    |         +--------+        |                |        |
|  |  2. Publish to |-------->| JSR or |<-------|  1. Download   |        |
|  |     JSR or npm |         |  npm   |        |  2. Verify     |        |
|  +----------------+         +--------+        |  3. Save to    |        |
|                                               |     ~/.hlvm/   |        |
|                                               |  4. Add to     |        |
|                                               |     Launchpad  |        |
|                                               +----------------+        |
|                                                                         |
|  WHY: Zero infrastructure. JSR/npm already exist, already work,         |
|  already have auth, CDN, search, and millions of users.                 |
|                                                                         |
|  Compare:                                                               |
|    Custom registry:  Server + DB + CDN + API + auth + CI + $$$          |
|    JSR/npm:          Already exists. Zero cost. Zero maintenance.        |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## What the Module Contains

There is no custom registry metadata format. JSR and npm handle package
metadata, versioning, and discovery using their own formats. HLVM only cares
about one thing: the `__hlvm_meta` export inside the compiled ESM module.

### Module Metadata (what the compiled main.js contains)

```
+--- main.js --- __hlvm_meta export ----------------------------------------+
|                                                                            |
|  export const __hlvm_meta = {                                              |
|    name:        "Competitor Monitor",                                      |
|    description: "Track competitor pricing changes",                        |
|    version:     "2.0.0",                                                   |
|    author:      "jane",                                                    |
|    icon:        "chart.bar.xaxis",          // SF Symbol                   |
|    effect:      "agent",                    // auto-detected               |
|    permissions: ["network", "filesystem"],  // auto-detected               |
|    category:    "monitoring",                                              |
|    params:      [                                                          |
|      { name: "url", type: "string", label: "Competitor URL" },            |
|      { name: "frequency", type: "select",                                 |
|        options: ["hourly", "daily", "weekly"] }                            |
|    ]                                                                       |
|  };                                                                        |
|                                                                            |
|  // Plus the actual code:                                                  |
|  export async function monitor(url, frequency) { ... }                     |
|                                                                            |
|  KEY INSIGHT:                                                              |
|  - The module is self-describing. No separate manifest.                    |
|  - GUI reads __hlvm_meta directly from the ESM module.                     |
|  - Effect and permissions are compiler-inferred, not declared.             |
|  - The compiled JS IS the module. Self-contained.                          |
|                                                                            |
+----------------------------------------------------------------------------+
```

### What goes where

```
Information              JSR/npm               __hlvm_meta
--------------          --------------        -------------
Name                    yes (package.json)    yes (display)
Description             yes (package.json)    yes (display)
Author                  yes (package.json)    yes (display)
Category                no                    yes (HLVM-specific)
Version                 yes (semver)          yes (current)
Download URL            yes (registry CDN)    no
Integrity hash          yes (registry)        no
File size               yes (registry)        no
Icon                    no                    yes (SF Symbol)
Effect                  no                    yes (auto-detected)
Permissions             no                    yes (auto-detected)
Params                  no                    yes (UI generation)
Code                    yes (it IS a pkg)     yes (it IS the code)

Rule: JSR/npm = discovery + download + versioning.
      __hlvm_meta = HLVM runtime metadata + execution.
```

---

## Publishing Flow

### CLI Commands: `hlvm deploy`

Three modes:

```
$ hlvm deploy                  Build + install locally only
$ hlvm deploy --jsr            Build + publish to JSR
$ hlvm deploy --npm            Build + publish to npm
```

### Example: Publishing to JSR

```
$ hlvm deploy --jsr

  Step 1/2: Compiling
  index.hql -> main.js ...................... done
  Effect detected: agent (uses agent() calls)
  Permissions detected: network, filesystem

  Step 2/2: Publishing to JSR
  Publishing to jsr.io/@jane/competitor-monitor@2.0.0 .. done

  Deployed locally + published to JSR.
  Others can install: hlvm install jsr:@jane/competitor-monitor
```

### Example: Local-only deploy

```
$ hlvm deploy

  Step 1/1: Compiling
  index.hql -> main.js ...................... done
  Effect detected: agent

  Installed locally to ~/.hlvm/modules/local/competitor-monitor/
  Added to Launchpad.

  To publish for others:
    hlvm deploy --jsr    (publish to JSR)
    hlvm deploy --npm    (publish to npm)
```

### What `hlvm deploy --jsr` Does Internally

```
+----------------------------------------------------------------------+
|                                                                      |
|  $ hlvm deploy --jsr                                                 |
|                                                                      |
|  Step 1: Compile HQL -> ESM                                          |
|  +--------------------------------------------------------------+   |
|  | index.hql -> main.js  (7-stage compiler pipeline)             |   |
|  | Effect checker auto-detects effect + permissions              |   |
|  | __hlvm_meta export embedded in the compiled output            |   |
|  | No separate hlvm.json. The JS IS the module.                  |   |
|  +--------------------------------------------------------------+   |
|                      |                                               |
|  Step 2: Publish to JSR (or npm with --npm)                          |
|  +--------------------------------------------------------------+   |
|  |                                                                |   |
|  |  Uses standard tooling under the hood:                        |   |
|  |                                                                |   |
|  |  --jsr: Generates jsr.json, runs `deno publish`               |   |
|  |    Package: jsr:@jane/competitor-monitor@2.0.0                |   |
|  |                                                                |   |
|  |  --npm: Generates package.json, runs `npm publish`            |   |
|  |    Package: @jane/competitor-monitor@2.0.0                    |   |
|  |                                                                |   |
|  |  Auth handled by JSR/npm (their own login flows).             |   |
|  |  HLVM does not manage auth separately.                        |   |
|  |                                                                |   |
|  +--------------------------------------------------------------+   |
|                      |                                               |
|  Step 3: Install locally                                             |
|  +--------------------------------------------------------------+   |
|  | Save compiled module to ~/.hlvm/modules/                       |   |
|  | Add to Launchpad                                               |   |
|  +--------------------------------------------------------------+   |
|                                                                      |
|  +-- WHY THIS MODEL -------------------------------------------+    |
|  |                                                              |    |
|  |  - Zero custom infrastructure (no server, no Git registry)  |    |
|  |  - JSR/npm handle auth, CDN, versioning, search             |    |
|  |  - Authors own their packages (standard JSR/npm accounts)   |    |
|  |  - Modules are standard ESM (work outside HLVM too)         |    |
|  |  - Billions of dollars of infrastructure, free to use       |    |
|  |  - Proven at scale: npm serves 2M+ packages                 |    |
|  |                                                              |    |
|  +--------------------------------------------------------------+   |
|                                                                      |
+----------------------------------------------------------------------+
```

### Other Build Commands

```
$ hlvm build [path]            Compile HQL -> ESM only (inspect/debug)
$ hlvm run <module> [args]     Run a module (auto-compiles if needed)
```

`hlvm build` is useful for inspecting compiler output without installing
or publishing. `hlvm run` is the fastest path from source to execution.

---

## Discovery Flow

### GUI: Module Store View

The HLVM macOS app includes a Store view for browsing modules. The GUI
searches JSR and npm for modules containing `__hlvm_meta` exports:

```
+--------------------------------------------------------------+
|                     HLVM Module Store                          |
+--------------------------------------------------------------+
|                                                              |
|  +------------------------------------------------------+    |
|  | Q  Search modules...                                 |    |
|  +------------------------------------------------------+    |
|                                                              |
|  FEATURED                                      See All >     |
|  +------------------------------------------------------+    |
|  |  +--------+  +--------+  +--------+  +--------+      |    |
|  |  | Sentmnt|  | Report |  |CodeRevw|  |Resrchr |      |    |
|  |  | @hlvm  |  | @hlvm  |  | @alice |  | @bob   |      |    |
|  |  | AI     |  | Agent  |  | AI     |  | Agent  |      |    |
|  |  +--------+  +--------+  +--------+  +--------+      |    |
|  +------------------------------------------------------+    |
|                                                              |
|  RECENTLY ADDED                                See All >     |
|  +------------------------------------------------------+    |
|  |  1. Competitor Monitor    @jane        Agent           |    |
|  |  2. Stock Analyzer        @carol       AI              |    |
|  |  3. Email Triager         @dave        Agent           |    |
|  |  4. PDF Summarizer        @hlvm        AI              |    |
|  |  5. Test Generator        @eve         Agent           |    |
|  +------------------------------------------------------+    |
|                                                              |
|  CATEGORIES                                                  |
|  +------+ +------+ +------+ +------+ +------+ +------+      |
|  | Data | |Write | | Code | |Resrch| |Auto  | |Mail  |      |
|  +------+ +------+ +------+ +------+ +------+ +------+      |
|                                                              |
|  BY EFFECT LEVEL                                             |
|  +----------+  +----------+  +----------+                    |
|  | Pure     |  | AI       |  | Agent    |                    |
|  | 142 mods |  | 891 mods |  | 367 mods |                    |
|  +----------+  +----------+  +----------+                    |
|                                                              |
+--------------------------------------------------------------+
```

Featured modules are curated via a simple JSON file shipped with HLVM
(updated with each release). No custom registry infrastructure needed.

### GUI: Module Detail View

When the user clicks a module, the detail view displays metadata read from
`__hlvm_meta` in the compiled ESM (downloaded on demand or from a cached
summary):

```
+--------------------------------------------------------------+
|  < Back                                                      |
+--------------------------------------------------------------+
|                                                              |
|  Competitor Monitor                                   v2.0.0 |
|  by @jane                                                    |
|                                                              |
|  Track competitor pricing changes across multiple sites      |
|  and receive alerts when prices change. Configurable         |
|  check frequency and threshold alerts.                       |
|                                                              |
|  +----------------------------------------+                  |
|  |  Effect:       Agent (full access)     |                  |
|  |  Permissions:  network, filesystem     |                  |
|  |  Category:     Monitoring              |                  |
|  |  Size:         4.2 KB                  |                  |
|  |  Source:       jsr.io/@jane/...        |                  |
|  +----------------------------------------+                  |
|                                                              |
|  Input Parameters:                                           |
|  +----------------------------------------+                  |
|  |  url        string   "Competitor URL"  |                  |
|  |  frequency  select   hourly/daily/wkly |                  |
|  +----------------------------------------+                  |
|                                                              |
|              +------------------+                             |
|              |     Install      |                             |
|              +------------------+                             |
|                                                              |
+--------------------------------------------------------------+
```

### GUI: Search Results (Spotlight Integration)

The HLVM Spotlight also searches JSR and npm:

```
+----------------------------------------------+
| Q  sentiment                                  |
+----------------------------------------------+
|                                              |
|  INSTALLED (Launchpad)                       |
|  Sentiment Analyzer             @hlvm    AI  |
|                                        Run > |
|                                              |
|  ON JSR                                      |
|  Sentiment Dashboard            @alice  Agt  |
|                                    Install > |
|                                              |
|  ON NPM                                     |
|  Emotion Classifier             @bob     AI  |
|                                    Install > |
|                                              |
|  ON JSR                                      |
|  Sentiment Trends               @carol  Agt  |
|                                    Install > |
|                                              |
+----------------------------------------------+
```

Installed modules show "Run" (executes immediately from Launchpad).
Registry modules show "Install" (downloads then adds to Launchpad).

### CLI: Search and Install

```bash
$ hlvm search sentiment

  Results from JSR:
  jsr:@hlvm/sentiment-analyzer    AI       Official
    Classify text sentiment with confidence score

  jsr:@alice/sentiment-dashboard  Agent    Community
    Full sentiment analysis with visualizations

  Results from npm:
  npm:@bob/emotion-classifier     AI       Community
    Classify emotions (joy, anger, sadness, etc.)

$ hlvm install jsr:@hlvm/sentiment-analyzer

  Downloading from jsr.io/@hlvm/sentiment-analyzer .... done
  Reading __hlvm_meta ................................. done
  Installed to ~/.hlvm/modules/@hlvm/sentiment-analyzer/1.2.0/

  Added to Launchpad.
```

### Install Destination: Launchpad and Hotbar

```
Install -> Launchpad (ALL installed modules appear here)
                |
                +-- Pin / assign shortcut -> Hotbar (frequently used subset)

+--- Launchpad -----------------------------------------------------------+
|                                                                          |
|  ALL installed modules. The full inventory.                              |
|  Grid view in the macOS GUI. Every install lands here.                   |
|                                                                          |
|  +--------+ +--------+ +--------+ +--------+ +--------+                 |
|  |Sentimnt| | Commit | |CompMntr| |CSVFmt  | |EmailTrg|                 |
|  | @hlvm  | |@seoksn | | @jane  | | @bob   | | @dave  |                 |
|  +--------+ +--------+ +--------+ +--------+ +--------+                 |
|  +--------+ +--------+ +--------+                                        |
|  |PDFSumm | |TestGen | |StockAn |                                        |
|  | @hlvm  | | @eve   | |@carol  |                                        |
|  +--------+ +--------+ +--------+                                        |
|                                                                          |
+--------------------------------------------------------------------------+

+--- Hotbar ---------------------------------------------------------------+
|                                                                          |
|  SUBSET of Launchpad. Only what the user has pinned or                    |
|  assigned a keyboard shortcut to. Quick access bar.                      |
|                                                                          |
|  +--------+ +--------+ +--------+                                        |
|  |Sentimnt| | Commit | |CompMntr|                                        |
|  | Cmd+1  | | Cmd+2  | | Cmd+3  |                                        |
|  +--------+ +--------+ +--------+                                        |
|                                                                          |
|  Launchpad is EVERYTHING installed.                                      |
|  Hotbar is YOUR FAVORITES.                                               |
|                                                                          |
+--------------------------------------------------------------------------+
```

---

## Trust and Safety Model

### Trust Tiers

```
+-----------------------------------------------------------------+
|                       Trust Model                                |
|                                                                  |
|  +--------------+--------------+----------------------------+    |
|  | Tier         | Badge        | How to achieve             |    |
|  +--------------+--------------+----------------------------+    |
|  | Official     | Official     | Published by @hlvm org     |    |
|  |              | (blue)       | on JSR (@hlvm namespace)   |    |
|  +--------------+--------------+----------------------------+    |
|  | Verified     | Verified     | Curated/audited by HLVM    |    |
|  |              | (green)      | maintainers (verified list) |    |
|  +--------------+--------------+----------------------------+    |
|  | Community    | Community    | Any module on JSR/npm with  |    |
|  |              | (gray)       | __hlvm_meta export          |    |
|  +--------------+--------------+----------------------------+    |
|                                                                  |
|  How this works:                                                 |
|                                                                  |
|  - Official: Published under the @hlvm org on JSR                |
|  - Verified: Listed in verified.json shipped with HLVM           |
|              (maintainers audit and add entries)                  |
|  - Community: Any JSR/npm package with valid __hlvm_meta         |
|                                                                  |
|  Trust tier is determined by namespace (@hlvm) or inclusion      |
|  in a curated list. Simple, no custom CI pipeline needed.        |
|                                                                  |
+-----------------------------------------------------------------+
```

### Effect-Driven Permission Model

When a user installs a module, the GUI shows what it can do based on the
effect classification read from `__hlvm_meta`:

```
Installing "Competitor Monitor" by @jane (Verified)

  This module requires:

  Agent Effect --- Full system access

    - Network access     Make HTTP requests and AI calls
    - File system        Read and write files on your computer
    - Shell commands     Execute terminal commands

  This is an Agent module. It can take autonomous actions
  on your computer including reading/writing files and
  running commands.

           +----------+  +----------+
           |  Cancel   |  | Install  |
           +----------+  +----------+
```

For AI modules (no file/shell access):

```
Installing "Sentiment Analyzer" by @hlvm (Official)

  This module requires:

  AI Effect --- Network only

    - Network access     Make AI API calls

  This module only makes AI calls. It cannot access
  your files or run commands.

           +----------+  +----------+
           |  Cancel   |  | Install  |
           +----------+  +----------+
```

For Pure modules (no permissions):

```
Installing "CSV Formatter" by @bob (Community)

  This module requires:

  Pure --- No permissions needed

  This module runs entirely locally with no network
  access, file access, or system access.

                       +----------+
                       | Install  |
                       +----------+
```

### Safety Enforcement

The permission model is enforced at runtime, not just displayed:

```
Module declares:     effect: "ai", permissions: ["network"]
Module tries to:     read a file via agent()

Result:              BLOCKED. Module only has network permission.
                     User sees: "Sentiment Analyzer tried to access
                     the filesystem. This exceeds its declared
                     permissions. Allow? [Once] [Always] [Deny]"
```

This is sandboxing via the effect system. The module's `__hlvm_meta` declares
its permissions. The runtime enforces them.

### Install-Time Verification

When HLVM downloads a module from JSR or npm, it performs these checks:

```
1. __hlvm_meta:      Import module, check __hlvm_meta has required fields
2. Effect valid:     effect field is one of: pure, ai, agent
3. Permissions:      permissions array contains only known values
4. Size limit:       Max 1MB per module (ESM code should be small)
5. Name match:       Package name matches __hlvm_meta.name
```

Reports and moderation use standard JSR/npm reporting mechanisms. HLVM
maintainers can remove entries from the verified list at any time.

---

## Infrastructure

### The Entire "Backend"

```
+--------------------------------------------------------------+
|                    Module Infrastructure                       |
|                                                              |
|  +----------------------------------------------------------+|
|  |                                                          ||
|  |  JSR (jsr.io) and npm (npmjs.com)                        ||
|  |                                                          ||
|  |  Existing, battle-tested package registries.             ||
|  |  HLVM does not maintain any custom registry              ||
|  |  infrastructure. Zero servers. Zero cost.                ||
|  |                                                          ||
|  +----------------------------------------------------------+|
|                                                              |
|  What JSR/npm provide (for free):                            |
|    - Package hosting and CDN                                 |
|    - Authentication and authorization                        |
|    - Version management (semver)                             |
|    - Search and discovery APIs                               |
|    - Integrity verification (checksums)                      |
|    - Download statistics                                     |
|    - Abuse reporting                                         |
|                                                              |
|  What HLVM adds on top:                                      |
|    - __hlvm_meta convention (self-describing modules)        |
|    - featured.json (curated highlights, shipped with HLVM)   |
|    - verified.json (audited modules, shipped with HLVM)      |
|    - Effect-based permission enforcement at runtime          |
|    - Store GUI that searches JSR/npm with HLVM filtering     |
|                                                              |
|  Compare:                                                    |
|  +--------------------+------------------------------------+ |
|  |  Custom registry   |  JSR/npm reuse                     | |
|  +--------------------+------------------------------------+ |
|  |  API server         |  None (use JSR/npm APIs)          | |
|  |  Database           |  None (JSR/npm handle it)         | |
|  |  File storage       |  None (JSR/npm CDN)               | |
|  |  Auth system        |  None (JSR/npm auth)              | |
|  |  CI for registry    |  None (no custom registry)        | |
|  |  Cost               |  $0/month                         | |
|  |  Maintenance        |  None                             | |
|  +--------------------+------------------------------------+ |
|                                                              |
+--------------------------------------------------------------+
```

### Open Ecosystem

Modules are standard ESM packages on standard registries. Anyone can:

- Install from JSR or npm using standard tooling
- Import modules in any JavaScript project
- Run modules with any JS runtime (Node.js, Deno, Bun, browsers)
- Publish modules using standard JSR/npm workflows
- Use modules outside of HLVM entirely

The `__hlvm_meta` export is the only HLVM-specific convention. Everything
else is standard ESM. This prevents vendor lock-in and lowers the barrier
for authors.

---

## Ranking and Discovery

### Search

The `hlvm search` command and the GUI Store view delegate to JSR/npm APIs:

```
$ hlvm search sentiment

How it works:
  1. Query JSR API: GET https://api.jsr.io/packages?search=sentiment
  2. Query npm API: GET https://registry.npmjs.org/-/v1/search?text=sentiment
  3. Filter results: only packages with __hlvm_meta export
  4. Rank by relevance (name match > description match)
  5. Annotate with trust tier (Official / Verified / Community)
  6. Display results
```

### Featured and Categories

Featured modules are curated via JSON files shipped with HLVM:

```
~/.hlvm/ (or bundled in the app)
  featured.json       (maintainer-curated list of highlighted modules)
  verified.json       (audited modules that earn the Verified badge)
```

These files are updated with each HLVM release. No separate infrastructure.

### Categories

```
Data Analysis      Monitoring       Writing
Code Tools         Research         Communication
Automation         Finance          Education
DevOps             Design           Productivity
```

---

## CLI Reference

### CLI Commands

```
hlvm run <module> [args]              Run a module (auto-compiles if needed)
hlvm build [path]                     Compile only (inspect/debug)
hlvm deploy                           Build + install locally
hlvm deploy --jsr                     Build + publish to JSR
hlvm deploy --npm                     Build + publish to npm
hlvm install jsr:<module>[@version]   Install from JSR
hlvm install npm:<module>[@version]   Install from npm
hlvm uninstall <module>               Remove from Launchpad + delete files
hlvm update                           Check for newer versions
hlvm search <query>                   Search JSR/npm for modules
hlvm info <module>                    Show module details
```

### Local Module Directory

```
~/.hlvm/modules/
+-- @hlvm/
|   +-- sentiment-analyzer/
|       +-- 1.2.0/
|       |   +-- main.js           (compiled ESM -- code + __hlvm_meta)
|       +-- current -> 1.2.0/     (symlink to active version)
+-- @jane/
|   +-- competitor-monitor/
|       +-- 2.0.0/
|       |   +-- main.js
|       +-- current -> 2.0.0/
+-- local/
|   +-- my-commit/
|       +-- main.js               (local-only, deployed via hlvm deploy)
+-- index.json                    (local module index for fast lookup)
```

### Namespace Convention

```
@hlvm/*        Official modules (published to JSR by @hlvm org)
@<username>/*  User modules (from JSR/npm, e.g. @jane/competitor-monitor)
local/*        Local-only modules (hlvm deploy without --jsr/--npm)
```

---

## Migration and Compatibility

### ESM Compatibility

Modules are standard ESM JavaScript packages on standard registries. They can be:

- Imported by any JavaScript project (`import { analyze } from "...";`)
- Run by any JS runtime (Node.js, Deno, Bun, browsers)
- Installed via standard tools (`deno add`, `npm install`)
- Used outside of HLVM entirely

HLVM is a convenience layer for HQL compilation, effect detection, and the
Launchpad/Hotbar GUI. The modules themselves are not locked to HLVM.

---

## Growth Stages

```
Stage 1 --- Bootstrap (Month 1-3):
  +-- Official @hlvm modules published to JSR
  +-- hlvm deploy + hlvm install commands working
  +-- hlvm deploy --jsr publishes to JSR correctly
  +-- Store view in macOS GUI searching JSR
  +-- 20-30 official @hlvm/* modules on JSR
  +-- featured.json and verified.json shipped with HLVM
  +-- Goal: prove the loop works (author -> deploy --jsr -> search -> install)

Stage 2 --- Community (Month 3-6):
  +-- Community authors publishing to JSR/npm
  +-- Store GUI searching both JSR and npm
  +-- hlvm search returning results from both registries
  +-- Verified badge program (maintainers audit and list modules)
  +-- Categories populated in Store GUI
  +-- Goal: 100+ community modules with __hlvm_meta, early flywheel

Stage 3 --- Growth (Month 6-12):
  +-- Curated featured list updated regularly
  +-- Verified badge program scales with community reviewers
  +-- Module composition tools (modules calling modules)
  +-- AI-authored module publishing workflows
  +-- Private registry support (private JSR/npm scopes)
  +-- Goal: 1,000+ modules, self-sustaining ecosystem

Stage 4 --- Scale (Month 12+):
  +-- Enterprise private registries (private JSR/npm scopes)
  +-- Module analytics (download counts via JSR/npm APIs)
  +-- Cross-registry search improvements
  +-- HLVM becomes the default way to use AI on macOS
  +-- Goal: HLVM is to AI modules what VS Code is to extensions
```
# 04 — User Journeys

**End-to-end flows for authors, consumers, and AI-authored modules.**

---

## Journey 1: Consumer — Find, Install, Use

Sarah is a marketing analyst. She analyzes customer reviews weekly. She has
HLVM installed on her Mac.

### Step 1: Browse the Registry

Sarah opens the HLVM app and clicks Browse. The app searches JSR and npm for
available HLVM modules (any ESM module with `__hlvm_meta`).

```
┌──────────────────────────────────────────────────────────────┐
│                     HLVM Module Registry                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Q  sentiment analysis                                │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 2: Search and Browse Results

```
┌──────────────────────────────────────────────────────────────┐
│ Q  sentiment analysis                                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  😊  Sentiment Analyzer              ★ 2.4k  ✓ Official    │
│      Classify text sentiment with confidence scores      ▸   │
│      ● AI · @hlvm                                            │
│                                                              │
│  📊  Batch Sentiment Processor       ★ 890   ✓ Verified    │
│      Analyze sentiment across CSV files                  ▸   │
│      ● Agent · @jane                                         │
│                                                              │
│  🎭  Multi-Language Sentiment        ★ 340   Community      │
│      Sentiment analysis in 12 languages                  ▸   │
│      ● AI · @carlos                                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 3: View Details and Install

Sarah clicks "Batch Sentiment Processor":

```
┌──────────────────────────────────────────────────────────────┐
│  ◀ Back                                                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  📊  Batch Sentiment Processor                       v1.5.0  │
│  by @jane · Verified ✓                                       │
│  ★★★★★ 4.8  ·  890 stars  ·  3.2k installs                  │
│                                                              │
│  Analyze sentiment across an entire CSV file.                │
│  Reads a CSV, processes each row through AI,                 │
│  outputs results as a new CSV with sentiment                 │
│  scores and a summary report.                                │
│                                                              │
│  Effect:       ● Agent (needs file access)                   │
│  Permissions:  network (AI calls), filesystem (read/write)   │
│                                                              │
│  Input: csv_path (string) — Path to your CSV file            │
│                                                              │
│              ┌──────────────────┐                             │
│              │     Install      │                             │
│              └──────────────────┘                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Sarah clicks Install. Permission prompt:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  "Batch Sentiment Processor" needs:                      │
│                                                          │
│    ☐ Network — to make AI API calls                      │
│    ☐ Filesystem — to read your CSV and write results     │
│                                                          │
│           ┌──────────┐  ┌──────────┐                     │
│           │  Cancel   │  │  Allow   │                     │
│           └──────────┘  └──────────┘                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Sarah clicks Allow. Module downloads and appears in her Launchpad.

### Step 4: Use the Module

Sarah opens Launchpad (all installed modules) and clicks the new module.
She can also pin it to the Hotbar for one-click access later.

```
Sarah's Launchpad (all installed):
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
│ 💬 │ │ 📊 │ │ 📝 │ │ 🔍 │ │ ⚙  │
│Chat│ │Sent│ │Note│ │Srch│ │Sets│
└────┘ └─┬──┘ └────┘ └────┘ └────┘
         │
         │ Sarah clicks this
         ▼

┌──────────────────────────────────────────┐
│  📊 Batch Sentiment Processor            │
│                                          │
│  CSV File Path:                          │
│  ┌──────────────────────────────────┐    │
│  │ ~/data/customer-reviews.csv      │    │
│  └──────────────────────────────────┘    │
│                                          │
│              ┌──────────┐                │
│              │    Run    │                │
│              └──────────┘                │
│                                          │
└──────────────────────────────────────────┘
```

Sarah enters the path and clicks Run:

```
┌──────────────────────────────────────────┐
│  📊 Batch Sentiment Processor            │
│                                          │
│  Running...                              │
│                                          │
│  ✓ Read 247 reviews from CSV             │
│  ⟳ Analyzing sentiment... (142/247)      │
│  ◻ Writing results                       │
│  ◻ Generating summary                    │
│                                          │
└──────────────────────────────────────────┘
```

After completion:

```
┌──────────────────────────────────────────┐
│  📊 Batch Sentiment Processor            │
│                                          │
│  ✓ Complete                              │
│                                          │
│  Results:                                │
│    Positive: 168 (68%)                   │
│    Neutral:   52 (21%)                   │
│    Negative:  27 (11%)                   │
│                                          │
│  Files created:                          │
│    ~/data/customer-reviews-sentiment.csv │
│    ~/data/sentiment-summary.md           │
│                                          │
│  ┌──────────────┐  ┌──────────────┐      │
│  │ Open Results  │  │    Done     │      │
│  └──────────────┘  └──────────────┘      │
│                                          │
└──────────────────────────────────────────┘
```

**Total time: ~2 minutes (search, install, run). No code written. No terminal.**

---

## Journey 2: Author — Write, Deploy, Share

Jake is a developer who wrote a useful HQL module for code review.

### Step 1: Write the Module

One file. Metadata and code live together in `index.hql`. The `(module ...)` form
is always the first expression. No separate manifest, no JSON config.

```
~/projects/code-reviewer/

index.hql:
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  (module                                                     │
│    {name:        "Code Reviewer"                             │
│     description: "AI-powered code review with severity       │
│                   classification and line-level feedback"     │
│     version:     "1.0.0"                                     │
│     author:      "jake"                                      │
│     icon:        "doc.text.magnifyingglass"                  │
│     category:    "code-tools"                                │
│     params:      [{name: "file-path"                         │
│                    type: "string"                             │
│                    label: "File to review"}]})                │
│                                                              │
│  ;; Effect and permissions are AUTO-DETECTED by the compiler │
│  ;; The compiler sees ai() calls → marks effect: "ai"        │
│  ;; The compiler sees readFile → marks permissions: network,  │
│  ;;   filesystem                                             │
│                                                              │
│  (import {readFile} from "hlvm:fs")                          │
│                                                              │
│  (generable ReviewResult {                                   │
│    issues:      [{severity: (case "high" "medium" "low")     │
│                   line:     number                           │
│                   message:  string}]                         │
│    summary:     string                                       │
│    score:       {type: number min: 0 max: 10}})              │
│                                                              │
│  (export (defn review [file-path]                            │
│    (let [code (await (readFile file-path))]                  │
│      (ai "Review this code for bugs, security issues,        │
│           and style problems. Be specific about line          │
│           numbers."                                          │
│        {data: code schema: ReviewResult}))))                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Compiles to ONE file: main.js (code + __hlvm_meta embedded).
No separate manifest. The compiled JS IS the module.
```

### Step 2: Test Locally

```
$ hlvm run ./index.hql --file-path ./test.ts

  {
    "issues": [
      { "severity": "high", "line": 42, "message": "SQL injection..." },
      { "severity": "medium", "line": 15, "message": "Unused variable..." }
    ],
    "summary": "2 issues found: 1 high severity (SQL injection)...",
    "score": 6.5
  }
```

### Step 3: Deploy

`hlvm deploy --jsr` compiles the module and publishes it to JSR in one step.

```
$ hlvm deploy --jsr

  Step 1/2: Compiling
  index.hql → main.js ........................ done
  Effect detected: ai (uses ai() calls)
  Permissions detected: network, filesystem

  Step 2/2: Publishing to JSR
  Publishing jsr:@jake/code-reviewer@1.0.0 .... done

  Deployed locally + published to JSR.
  Others can install: hlvm install jsr:@jake/code-reviewer
```

### Step 4: Watch It Grow

Jake can check stats from CLI or the registry page on GitHub:

```
$ hlvm stats @jake/code-reviewer

  @jake/code-reviewer v1.0.0
  Published: 2026-03-30

  Stars:     47    (↑ 12 this week)
  Installs:  183   (↑ 56 this week)
  Rating:    4.6   (8 reviews)

  Top review:
    ★★★★★ @sarah "Found a critical bug I missed. Saving this!"
```

### Step 5: Iterate and Update

Jake improves his module based on feedback:

```
$ hlvm deploy --jsr

  Compiling index.hql → main.js .............. done
  Published jsr:@jake/code-reviewer@1.1.0 .... done

  Users with auto-update will receive this version.
```

---

## Journey 3: AI-Authored Module

This is the ultimate vision: AI creates AI capabilities.

### Step 1: User Describes What They Want

```
┌──────────────────────────────────────────────────────────────┐
│  💬 HLVM Chat                                                │
│                                                              │
│  User: I need a module that monitors my competitor's website │
│        at example-competitor.com, checks pricing daily, and  │
│        alerts me if anything changes by more than 5%.        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 2: HLVM Agent Builds the Module

```
┌──────────────────────────────────────────────────────────────┐
│  💬 HLVM Chat                                                │
│                                                              │
│  Agent: I'll create a pricing monitor module for you.        │
│                                                              │
│  ◆ Creating module...                                        │
│    ├── Writing index.hql (code + module metadata)            │
│    ├── Testing locally                                       │
│    └── Compiling to main.js (code + __hlvm_meta)             │
│                                                              │
│  ✓ Module created: competitor-monitor                        │
│                                                              │
│  It monitors example-competitor.com/pricing daily and        │
│  sends you a notification if any price changes by > 5%.      │
│                                                              │
│  Would you like to:                                          │
│  [Install]  [Deploy to Registry]  [View Code]                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 3: Module in Launchpad (Optionally Pinned to Hotbar)

The user clicks "Install". The module appears in Launchpad (all installed):

```
Launchpad (all installed modules):
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
│ 💬 │ │ 📊 │ │ 📝 │ │ 🔍 │ │ 📡 │   ← NEW
│Chat│ │Sent│ │Note│ │Srch│ │Mon │
└────┘ └────┘ └────┘ └────┘ └────┘
```

The user can right-click and "Pin to Hotbar" for quick access. But the module
is already usable from Launchpad immediately.

One click to run. The module that AI built is indistinguishable from a
human-authored module. Same format, same execution, same GUI.

### Step 4: (Optional) Deploy to JSR

If the module is useful, the user can publish it for others:

```
$ hlvm deploy --jsr

  Compiling index.hql → main.js .............. done
  Published jsr:@sarah/competitor-monitor@1.0.0 .. done

  Available to all HLVM users via: hlvm install jsr:@sarah/competitor-monitor
```

**The loop: AI builds a capability → user uses it → user shares it →
other users benefit.** The platform produces its own content.

---

## Journey 4: PRD-to-Delivery (Advanced)

The most ambitious flow: human writes a high-level requirement, AI handles
everything else.

### Step 1: Human Writes PRD

```
┌──────────────────────────────────────────────────────────────┐
│  💬 HLVM Chat                                                │
│                                                              │
│  User: Build me a complete competitor intelligence suite:     │
│                                                              │
│        1. Monitor 5 competitor websites for pricing changes  │
│        2. Track their social media sentiment weekly          │
│        3. Generate a weekly comparison report                │
│        4. Alert me immediately on significant changes        │
│                                                              │
│        Competitors: acme.com, globex.com, initech.com,       │
│        umbrella.com, waynetech.com                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 2: Meta-Orchestrator Plans

```
┌──────────────────────────────────────────────────────────────┐
│  💬 HLVM Chat                                                │
│                                                              │
│  Agent (Lead): I'll build this as 4 composable modules:      │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Module 1: price-monitor                                │ │
│  │    Scrapes pricing pages, detects changes               │ │
│  │    Effect: Agent · Permissions: network, filesystem     │ │
│  │                                                         │ │
│  │  Module 2: social-sentiment                             │ │
│  │    Tracks social media mentions, classifies sentiment   │ │
│  │    Effect: Agent · Permissions: network                 │ │
│  │                                                         │ │
│  │  Module 3: weekly-report                                │ │
│  │    Combines price + sentiment data, generates report    │ │
│  │    Effect: Agent · Permissions: network, filesystem     │ │
│  │    Imports: price-monitor, social-sentiment             │ │
│  │                                                         │ │
│  │  Module 4: change-alert                                 │ │
│  │    Runs price-monitor, alerts on >5% change             │ │
│  │    Effect: Agent · Permissions: network, filesystem     │ │
│  │    Imports: price-monitor                               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Spawning team to build these...                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 3: Team Builds Modules

```
┌──────────────────────────────────────────────────────────────┐
│  💬 HLVM Chat                                                │
│                                                              │
│  Team Activity:                                              │
│                                                              │
│  ◆ Researcher: Analyzing competitor website structures...    │
│  ◆ Coder-1:    Writing price-monitor.hql .............. done │
│  ◆ Coder-2:    Writing social-sentiment.hql ........... done │
│  ◆ Coder-1:    Writing weekly-report.hql .............. done │
│  ◆ Coder-2:    Writing change-alert.hql ............... done │
│  ◆ Tester:     Testing all modules .................... done │
│  ◆ Lead:       Compiling and verifying ................ done │
│                                                              │
│  ✓ All 4 modules built, tested, and ready.                   │
│                                                              │
│  [Install All]  [Deploy to Registry]  [View Code]            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Step 4: Four New Modules in Launchpad

All four appear in Launchpad immediately. The user can pin any to the Hotbar
for quick access.

```
Launchpad (all installed):
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
│ 💬 │ │ 💰 │ │ 📱 │ │ 📋 │ │ 🚨 │ │ 📊 │ │ 📝 │ │ ⚙  │
│Chat│ │Pric│ │Socl│ │Wkly│ │Alrt│ │Sent│ │Note│ │Sets│
└────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘
       ─────────────────────────
       These 4 are NEW, built by AI

Hotbar (pinned subset — user pins their favorites):
┌────┐ ┌────┐ ┌────┐
│ 💬 │ │ 🚨 │ │ 📋 │
│Chat│ │Alrt│ │Wkly│
└────┘ └────┘ └────┘
```

Each module is independent, composable, and executable with one click.

---

## Journey 5: Launchpad & Hotbar Management

```
Launchpad = ALL installed modules (superset, searchable, scrollable grid).
Hotbar    = PINNED subset (always visible, quick access, keyboard shortcuts).

Install → Launchpad → (optionally) Pin to Hotbar.
```

### Pinning from Launchpad to Hotbar

The Launchpad is the full inventory. The Hotbar is managed by pinning and
unpinning modules from Launchpad.

```
Right-click a module in Launchpad:

  ┌──────────────────────────┐
  │  Run                     │
  │  ────────────────────    │
  │  View Details            │
  │  Check for Updates       │
  │  ────────────────────    │
  │  Pin to Hotbar           │  ← adds to the quick-access bar
  │  Assign Shortcut...      │  ← assigns key AND pins to Hotbar
  │  ────────────────────    │
  │  Uninstall               │
  └──────────────────────────┘
```

"Pin to Hotbar" adds the module to the always-visible quick-access bar.
"Assign Shortcut" assigns a keyboard shortcut AND automatically pins to Hotbar.
"Uninstall" removes it from both Launchpad and Hotbar.

### Rearranging the Hotbar

```
Drag-and-drop on the Hotbar:

Before:
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
│ 💬 │ │ 📊 │ │ 📝 │ │ 🔍 │ │ ⚙  │
│Chat│ │Sent│ │Note│ │Srch│ │Sets│
└────┘ └────┘ └────┘ └────┘ └────┘

User drags 🔍 to position 1:

After:
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
│ 💬 │ │ 🔍 │ │ 📊 │ │ 📝 │ │ ⚙  │
│Chat│ │Srch│ │Sent│ │Note│ │Sets│
└────┘ └────┘ └────┘ └────┘ └────┘
```

### Unpinning from Hotbar

```
Right-click a module on the Hotbar:

  ┌──────────────────────────┐
  │  Run                     │
  │  ────────────────────    │
  │  View Details            │
  │  ────────────────────    │
  │  Unpin from Hotbar       │  ← removes from Hotbar, stays in Launchpad
  │  Uninstall               │  ← removes from both
  └──────────────────────────┘
```

"Unpin from Hotbar" removes it from the quick-access bar but keeps it installed
in Launchpad. "Uninstall" removes it completely.

### Switching Profiles (Loadouts)

Hotbar profiles let you swap entire pinned sets for different workflows:

```
┌──────────────────────────────────────────────────────────────┐
│  Hotbar Profiles                                             │
│                                                              │
│  ● Default                                                   │
│    ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                      │
│    │ 💬 │ │ 📊 │ │ 📝 │ │ 🔍 │ │ ⚙  │                      │
│    └────┘ └────┘ └────┘ └────┘ └────┘                      │
│                                                              │
│  ○ Research                                                  │
│    ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                      │
│    │ 🔍 │ │ 📄 │ │ 📈 │ │ 📚 │ │ 📝 │                      │
│    └────┘ └────┘ └────┘ └────┘ └────┘                      │
│                                                              │
│  ○ Development                                               │
│    ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                      │
│    │ 💻 │ │ 🧪 │ │ 🔍 │ │ 🚀 │ │ 📋 │                      │
│    └────┘ └────┘ └────┘ └────┘ └────┘                      │
│                                                              │
│  [+ New Profile]                                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

All modules in every profile are installed in Launchpad. Profiles just control
which subset is pinned to the Hotbar. Like Diablo: different skill loadouts for
different encounters. The GUI is simple — radio buttons and drag-and-drop. But
the concept is powerful: **pre-configured sets of AI capabilities for different
workflows.**
# 05 — Competitive Analysis

**What exists, what doesn't, and where HLVM fits.**

---

## The Landscape (2026)

### Category 1: Chat Interfaces

Products where AI is accessed through conversation.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ChatGPT / Claude / Gemini                                   │
│                                                              │
│  What they do well:                                          │
│  ├── Natural language interaction                            │
│  ├── Broad knowledge                                         │
│  ├── Custom GPTs / Projects / Gems                           │
│  └── Growing tool access (code interpreter, browsing)        │
│                                                              │
│  What they cannot do:                                        │
│  ├── Access your local filesystem                            │
│  ├── Run commands on your computer                           │
│  ├── Orchestrate multi-agent teams                           │
│  ├── Be automated (each use is manual)                       │
│  ├── Compose into pipelines                                  │
│  └── Work offline / with local models                        │
│                                                              │
│  Verdict: Great for one-off questions.                       │
│           Cannot automate anything.                          │
│           Cannot access your local system.                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Category 2: Code-First Agent Frameworks

Products for developers who write agent orchestration in Python/JS.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  LangChain / CrewAI / AutoGen / Mastra                       │
│                                                              │
│  What they do well:                                          │
│  ├── Full programmatic control                               │
│  ├── Multi-agent orchestration                               │
│  ├── Tool/function calling                                   │
│  ├── Memory systems                                          │
│  └── Multi-provider support                                  │
│                                                              │
│  What they cannot do:                                        │
│  ├── Non-developers cannot use them at all                   │
│  ├── No GUI — terminal only                                  │
│  ├── No one-click execution                                  │
│  ├── No module marketplace / sharing                         │
│  ├── No native macOS integration                             │
│  ├── Heavy Python dependency management                      │
│  └── Each project is a fresh setup                           │
│                                                              │
│  Verdict: Powerful for developers.                           │
│           Inaccessible to everyone else.                     │
│           No ecosystem / sharing story.                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Category 3: macOS Automation

Products that automate workflows on Mac with visual interfaces.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Apple Shortcuts / Automator / Raycast                        │
│                                                              │
│  What they do well:                                          │
│  ├── Native macOS integration                                │
│  ├── Visual workflow builder (Shortcuts)                     │
│  ├── Spotlight-style launcher (Raycast)                      │
│  ├── One-click execution                                     │
│  └── Some AI features (Raycast AI)                           │
│                                                              │
│  What they cannot do:                                        │
│  ├── No multi-agent orchestration                            │
│  ├── No real programming language                            │
│  ├── Limited AI integration (basic prompts only)             │
│  ├── Cannot compose complex AI pipelines                     │
│  ├── Cannot run autonomous agent loops                       │
│  ├── No schema-enforced AI output                            │
│  └── Shortcuts blocks are clunky for complex logic           │
│                                                              │
│  Verdict: Great for simple automation.                       │
│           Cannot handle complex AI workflows.                │
│           Limited composability.                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Category 4: AI Agent Products

Products that package AI agents with specific capabilities.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  PaperClip / Devin / Cursor / Claude Code                    │
│                                                              │
│  What they do well:                                          │
│  ├── Domain-specific AI agents (coding, research)            │
│  ├── Deep integration with their domain                      │
│  ├── Multi-step autonomous execution                         │
│  └── Some team/collaboration features                        │
│                                                              │
│  What they cannot do:                                        │
│  ├── Limited to their domain (coding only, etc.)             │
│  ├── Cannot create new capability types                      │
│  ├── No user-authored modules                                │
│  ├── No module marketplace                                   │
│  ├── Not a general platform                                  │
│  └── Cannot compose into other workflows                     │
│                                                              │
│  Verdict: Good at one thing.                                 │
│           Not a platform.                                    │
│           Cannot be extended by users.                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## The Gap

```
                    Full AI Power
                    (agents, teams,
                     multi-step,
                     local access)
                         ▲
                         │
  LangChain ●            │
  CrewAI    ●            │
  AutoGen   ●            │
                         │
                         │         ● HLVM
                         │           (HERE)
                         │
                         │
  Devin     ●            │
  PaperClip ●            │
                         │
                         │
  Raycast AI ●           │
                         │
  ChatGPT    ●           │         ● Apple Shortcuts
  Claude     ●           │
                         │
                         └──────────────────────────► Ease of Use
                    Developer-only              One-click for anyone
```

**The gap: nobody combines full AI power WITH one-click ease of use.**

- Upper-left (LangChain etc.): Full power, developer-only
- Lower-left (ChatGPT etc.): Easy but limited, no automation
- Lower-right (Shortcuts): Easy and automated, but weak AI
- **Upper-right (HLVM): Full power AND one-click. The empty quadrant.**

---

## Feature Comparison Matrix

```
┌───────────────────┬────────┬────────┬────────┬────────┬──────┐
│                   │ChatGPT │LangChn │Raycast │Shortct │ HLVM │
├───────────────────┼────────┼────────┼────────┼────────┼──────┤
│ AI calls          │  ✓     │  ✓     │  ✓     │  ~     │  ✓   │
│ Agent loops       │  ~     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Multi-agent teams │  ✗     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Local file access │  ✗     │  ✓     │  ~     │  ✓     │  ✓   │
│ Shell execution   │  ✗     │  ✓     │  ✗     │  ~     │  ✓   │
│ Real language     │  ✗     │  ✓(Py) │  ✗     │  ✗     │  ✓   │
│ Schema-typed AI   │  ✗     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Native macOS GUI  │  ✗     │  ✗     │  ✓     │  ✓     │  ✓   │
│ One-click execute │  ✗     │  ✗     │  ✓     │  ✓     │  ✓   │
│ Module registry   │  ~(GPT)│  ✗     │  ✓     │  ✓     │  ✓   │
│ Composable        │  ✗     │  ✓     │  ✗     │  ~     │  ✓   │
│ Multi-provider    │  ✗     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Local/offline     │  ✗     │  ✓     │  ✗     │  ✓     │  ✓   │
│ Memory/context    │  ~     │  ✓     │  ✗     │  ✗     │  ✓   │
│ Effect/safety     │  ✗     │  ✗     │  ✗     │  ✗     │  ✓   │
│ ESM portable      │  ✗     │  ✗     │  ✗     │  ✗     │  ✓   │
├───────────────────┼────────┼────────┼────────┼────────┼──────┤
│ TOTAL             │  3/16  │  10/16 │  4/16  │  5/16  │ 16/16│
└───────────────────┴────────┴────────┴────────┴────────┴──────┘

✓ = full support   ~ = partial/limited   ✗ = not supported
```

No other product scores above 10/16. HLVM scores 16/16.

The revolution is not any single column. It is the ONLY row that is all green.

---

## HLVM's Unique Advantages

### 1. The Only Full Stack

HLVM is the only product that spans the entire chain:

```
Authoring Language (HQL)
       ↓
Compilation (ESM)
       ↓
Distribution (Module Registry)
       ↓
Discovery (Store GUI + Spotlight)
       ↓
Installation (one click)
       ↓
Execution (Hotbar icon → agent engine)
       ↓
AI Runtime (multi-provider, multi-agent)
```

Every competitor owns only a slice of this chain.

### 2. Platform-Agnostic Output

ESM JavaScript runs everywhere. Modules created on HLVM can be:

```
Used in:
  ├── HLVM Launchpad/Hotbar (primary)
  ├── Any Node.js project (import from npm)
  ├── Any Deno project (import from JSR or HTTP)
  ├── Browsers (ESM native)
  ├── Bun
  └── Any future JS runtime

Not locked to HLVM. Standard format.
```

### 3. The Effect System as Safety Model

No other product has compile-time safety classification for AI modules:

```
Effect         →  Permission  →  GUI Badge  →  Runtime Sandbox
"pure"         →  none        →  ● Green    →  no access
"ai"           →  network     →  ● Yellow   →  network only
"agent"        →  full        →  ● Red      →  full access
```

Users can make informed decisions before installing. Modules are sandboxed
at runtime based on their declared effect level.

### 4. AI Can Author Modules

The platform consumes its own output:

```
User says "I need X"
  → AI builds an HQL module that does X
  → Module appears in Launchpad
  → User clicks to use it
  → Optionally deploys to Store for others
```

No other product has this self-reinforcing loop where AI creates shareable,
reusable, one-click capabilities.

### 5. The Network Effect Moat

Once the Registry has critical mass:

```
More modules → More users → More authors → More modules → ...
```

This flywheel is nearly impossible to replicate. You cannot copy a network
effect. You can only build your own.

---

## Risks and Mitigations

### Risk: "Nobody will write HQL"

**Mitigation**: Modules can also be written in plain JavaScript. HQL is the
recommended authoring language but not required. The Store accepts any valid
ESM with embedded `__hlvm_meta`. Additionally, AI can write modules —
users don't need to learn any language at all.

### Risk: "Not enough modules at launch"

**Mitigation**: Launch with 20-30 high-quality official @hlvm/* modules
covering common use cases (sentiment analysis, summarization, code review,
web research, report generation, etc.). These establish quality expectations
and give users immediate value.

### Risk: "Security of community modules"

**Mitigation**: Effect-based permission system, verified badge for reviewed
modules, runtime sandboxing, user reporting, automated malware scanning on
publish. Users can choose to only install Official/Verified modules.

### Risk: "macOS only"

**Mitigation**: The core is the hlvm binary (CLI), which runs on any platform.
The macOS GUI is a thin shell. The CLI provides identical functionality.
A web GUI or Linux GUI could be added later. Modules themselves are ESM —
they run everywhere.

### Risk: "Competing with Raycast / Apple"

**Mitigation**: Raycast is a launcher with AI chat. Apple Shortcuts is visual
blocks. Neither has a module registry for AI capabilities, agent orchestration,
multi-step pipelines, or a real programming language. HLVM operates in a
different category — it is a platform, not a launcher.
# 07 — Daily Driver Scenarios

**Concrete use cases that make HLVM your personal automation OS, not just a tool
you open sometimes.**

---

## The Core Loop

Every killer use case in HLVM follows the same three-step abstraction ladder:

```
Step 1: Write a function (parameterized, general)
Step 2: Bind your defaults (zero-param, personal)
Step 3: Assign a shortcut (one keystroke, instant)

Each step removes friction. By Step 3, the action is muscle memory.
```

This document walks through concrete scenarios that demonstrate why this matters
and what it feels like in practice.

---

## Scenario 1: Multi-Repo Commit

### The Problem

You work across multiple projects simultaneously. Every commit session is the
same ritual: check each directory, stage changes, write a message, skip tests,
push. Multiply by 3-5 repos. Every day.

### Step 1: The General Function

```lisp
;; commit.hql
(export (defn commit [directories]
  (agent "For each directory:
          1. cd into it
          2. Run git diff --stat to understand changes
          3. Write a concise, conventional commit message based on the diff
          4. Stage all changes (git add -A)
          5. Commit with --no-verify (skip hooks/tests)
          6. Report what was committed

          Do NOT push. Just commit locally."
    {data: {directories: directories}
     tools: ["shell_exec" "read_file"]})))
```

This compiles to an ESM module. You can run it from CLI:

```bash
hlvm run commit --directories '["~/dev/HLVM", "~/dev/hql"]'
```

Or from the GUI — click the icon, a form appears:

```
┌─────────────────────────────────────────────┐
│  Commit All                                 │
│                                             │
│  Directories:                               │
│  ┌─────────────────────────────────────┐    │
│  │ ~/dev/HLVM                          │    │
│  │ ~/dev/hql                           │    │
│  │ (+ add directory)                   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌────────────┐                             │
│  │  Execute   │                             │
│  └────────────┘                             │
└─────────────────────────────────────────────┘
```

This is already useful. But typing the same directories every time is tedious.

### Step 2: Personal Binding

```lisp
;; my-commit.hql
(import {commit} from "hlvm:@me/commit")

(export (defn my-commit []
  (commit ["~/dev/HLVM" "~/dev/hql" "~/dev/dotfiles"])))
```

Three lines. No parameters. `(my-commit)` does exactly what you want, every
time. The GUI form has no fields — just a confirmation button:

```
┌─────────────────────────────────────────────┐
│  My Commit                                  │
│                                             │
│  Will commit all changes in:                │
│  • ~/dev/HLVM                               │
│  • ~/dev/hql                                │
│  • ~/dev/dotfiles                           │
│                                             │
│  ┌────────────┐                             │
│  │  Execute   │                             │
│  └────────────┘                             │
└─────────────────────────────────────────────┘
```

### Step 3: Keyboard Shortcut

In the HLVM macOS app, any Hotbar module can be bound to a global keyboard
shortcut. This is native macOS capability — not a hack.

```
Settings > Shortcuts:

┌─────────────────────────────────────────────┐
│  Module Shortcuts                           │
│                                             │
│  ⌘⇧C    My Commit                          │
│  ⌘⇧D    My Deploy                          │
│  ⌘⇧S    Morning Summary                    │
│  ⌘⇧R    Quick Review                       │
│                                             │
│  ┌──────────────────────┐                   │
│  │  + Add Shortcut      │                   │
│  └──────────────────────┘                   │
└─────────────────────────────────────────────┘
```

Now: press `⌘⇧C` from anywhere on your Mac. HLVM commits all your repos with
AI-written messages. One second. Done.

### The Abstraction Ladder

```
commit.hql              → general purpose, takes parameters
    ↓ import + bind
my-commit.hql           → personal, zero parameters
    ↓ shortcut bind
⌘⇧C                    → muscle memory, < 1 second
```

This is the pattern. Every scenario below follows it.

---

## Scenario 2: Morning Standup Prep

### The Problem

Every morning before standup, you need to know: what did you do yesterday, what
PRs are open, what issues are assigned to you, across all projects.

### Step 1: The General Function

```lisp
;; standup.hql
(generable StandupReport {
  yesterday: [{repo: string commits: [string]}]
  open_prs:  [{repo: string title: string url: string status: string}]
  blockers:  [string]
  today:     [string]})

(export (defn standup [repos github-user]
  (agent "Generate a standup report:
          1. For each repo, get yesterday's commits by this user
          2. Check GitHub for open PRs by this user
          3. Check for any failing CI or review-requested PRs
          4. Suggest today's priorities based on PR states and recent work

          Output as structured StandupReport."
    {data: {repos: repos user: github-user}
     schema: StandupReport
     tools: ["shell_exec" "search_web"]})))
```

### Step 2: Personal Binding

```lisp
;; my-standup.hql
(import {standup} from "hlvm:@me/standup")

(export (defn my-standup []
  (standup
    ["~/dev/HLVM" "~/dev/hql" "~/dev/infra"]
    "your-github-username")))
```

### Step 3: Keyboard Shortcut

`⌘⇧S` — press at 9:55am, paste into Slack at 10:00am.

### What It Feels Like

```
You: press ⌘⇧S

HLVM (3 seconds later):
┌─────────────────────────────────────────────┐
│  Morning Standup — March 31, 2026           │
│                                             │
│  Yesterday:                                 │
│  • hql: 3 commits (routing evals, delegate  │
│    UX, platform vision docs)                │
│  • HLVM: 1 commit (shortcut binding UI)     │
│                                             │
│  Open PRs:                                  │
│  • hql#142 — structured output fallback     │
│    (CI passing, 1 approval)                 │
│  • infra#89 — k8s resource limits           │
│    (needs review)                           │
│                                             │
│  Today:                                     │
│  • Merge hql#142 (ready)                    │
│  • Address review on infra#89               │
│  • Continue vision docs                     │
│                                             │
│  ┌──────────┐ ┌──────────────┐              │
│  │  Copy    │ │  Copy as MD  │              │
│  └──────────┘ └──────────────┘              │
└─────────────────────────────────────────────┘
```

---

## Scenario 3: Cross-Repo Dependency Sync

### The Problem

You maintain several projects that share dependencies. When you bump a version
in one, you need to update the others. Today this is manual find-and-replace
across repos, then commit each one.

### Step 1: The General Function

```lisp
;; sync-deps.hql
(export (defn sync-deps [source-repo target-repos]
  (agent "1. Read the dependency manifest (package.json, deno.json, or
             Cargo.toml) from the source repo
          2. For each target repo, find shared dependencies
          3. Update target repos to match source versions
          4. Show a diff summary of what changed in each target
          5. Do NOT commit — just update the files"
    {data: {source: source-repo targets: target-repos}
     tools: ["read_file" "write_file" "shell_exec"]})))
```

### Step 2: Personal Binding

```lisp
;; my-sync.hql
(import {sync-deps} from "hlvm:@me/sync-deps")

(export (defn my-sync []
  (sync-deps "~/dev/hql" ["~/dev/HLVM" "~/dev/hql-vscode"])))
```

### Step 3: Compose

Now chain it with your commit module:

```lisp
;; my-sync-and-commit.hql
(import {my-sync} from "hlvm:@me/my-sync")
(import {commit} from "hlvm:@me/commit")

(export (defn my-sync-and-commit []
  (do
    (await (my-sync))
    (commit ["~/dev/HLVM" "~/dev/hql-vscode"]))))
```

One function. Syncs deps, then commits the changes. `⌘⇧U` and walk away.

---

## Scenario 4: PR Review Across Repos

### The Problem

You maintain multiple repos. PRs pile up. Reviewing each one means: open
GitHub, read the diff, understand context, write comments. Repeat N times.

### Step 1: The General Function

```lisp
;; review-prs.hql
(generable ReviewResult {
  repo:     string
  pr:       number
  title:    string
  verdict:  (case "approve" "request-changes" "comment")
  summary:  string
  comments: [{file: string line: number body: string}]})

(export (defn review-prs [repos github-user]
  (agent "For each repo:
          1. List open PRs where I am requested reviewer
          2. For each PR, read the full diff
          3. Analyze for: bugs, style issues, missing tests, security
          4. Write inline review comments
          5. Provide verdict (approve / request changes / comment)

          Do NOT submit reviews — just prepare them for my approval."
    {data: {repos: repos user: github-user}
     schema: [ReviewResult]
     tools: ["shell_exec" "search_web" "read_file"]})))
```

### Step 2: Personal Binding + GUI Approval

```lisp
;; my-review.hql
(import {review-prs} from "hlvm:@me/review-prs")

(export (defn my-review []
  (review-prs
    ["hlvm-org/hql" "hlvm-org/HLVM" "hlvm-org/infra"]
    "your-github-username")))
```

The key insight: the agent prepares reviews but does NOT submit them. The GUI
shows each review for human approval:

```
┌─────────────────────────────────────────────┐
│  PR Reviews Ready                           │
│                                             │
│  hql#142 — structured output fallback       │
│  Verdict: ✅ Approve                        │
│  "Clean implementation. Tests cover edge    │
│   cases. One minor suggestion on line 47."  │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐     │
│  │ Submit   │ │  Edit    │ │  Skip   │     │
│  └──────────┘ └──────────┘ └─────────┘     │
│                                             │
│  infra#89 — k8s resource limits             │
│  Verdict: 🔸 Request Changes                │
│  "Missing memory limit on worker pods.     │
│   See inline comments (3)."                 │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐     │
│  │ Submit   │ │  Edit    │ │  Skip   │     │
│  └──────────┘ └──────────┘ └─────────┘     │
└─────────────────────────────────────────────┘
```

The human is always in the loop for actions that are visible to others.

---

## Scenario 5: One-Click Environment Setup

### The Problem

You switch between projects. Each one has different environment needs: different
services to start, different env vars, different ports to check.

### Step 1: The General Function

```lisp
;; dev-env.hql
(export (defn start-env [config]
  (agent "Based on this configuration:
          1. Check if required services are running (ports)
          2. Start any that are missing
          3. Set environment variables
          4. Open relevant URLs in browser
          5. Report status"
    {data: config
     tools: ["shell_exec" "read_file"]})))
```

### Step 2: Personal Bindings (Multiple)

```lisp
;; env-hql.hql — for HQL development
(import {start-env} from "hlvm:@me/dev-env")

(export (defn env-hql []
  (start-env {
    dir: "~/dev/hql"
    services: [{name: "ollama" check-port: 11434 start: "ollama serve"}]
    env: {HLVM_DIR: "~/.hlvm-dev"}
    open: ["http://localhost:11434"]})))
```

```lisp
;; env-hlvm.hql — for HLVM GUI development
(import {start-env} from "hlvm:@me/dev-env")

(export (defn env-hlvm []
  (start-env {
    dir: "~/dev/HLVM"
    services: [
      {name: "hlvm-server" check-port: 8765 start: "hlvm serve"}
      {name: "ollama" check-port: 11434 start: "ollama serve"}]
    env: {HLVM_DIR: "~/.hlvm-dev"}
    open: ["http://localhost:8765/health"]})))
```

### Step 3: Hotbar Profile

These aren't just individual shortcuts — they're part of a Hotbar profile:

```
"HQL Development" profile:
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
│ 🔧 │ │ 📝 │ │ 🧪 │ │ 📋 │ │ 🚀 │
│Env │ │Cmit│ │Test│ │Stup│ │Dply│
│HQL │ │    │ │    │ │    │ │    │
└────┘ └────┘ └────┘ └────┘ └────┘
 ⌘⇧1   ⌘⇧C   ⌘⇧T   ⌘⇧S   ⌘⇧D
```

Switch profile = switch your entire toolbelt. Like loadouts in a game.

---

## Scenario 6: Research-to-Memo Pipeline

### The Problem

Your boss asks "what's the state of WebAssembly in 2026?" You need to research,
synthesize, and write a memo. Today: open 15 tabs, read for an hour, write for
an hour.

### Step 1: The General Function

```lisp
;; research-memo.hql
(export (defn research-memo [topic output-path]
  (agent "You are a senior analyst. Research this topic thoroughly:
          1. Search the web for recent developments (2025-2026)
          2. Find at least 5 authoritative sources
          3. Synthesize findings into a structured memo:
             - Executive Summary (3 sentences)
             - Key Developments (bulleted)
             - Market Impact
             - Recommendations
             - Sources (with URLs)
          4. Save the memo as markdown to the output path"
    {data: {topic: topic path: output-path}
     tools: ["search_web" "web_fetch" "write_file"]})))
```

### Step 2: Personal Binding with Defaults

```lisp
;; my-memo.hql
(import {research-memo} from "hlvm:@me/research-memo")

(export (defn my-memo [topic]
  (research-memo topic
    (str "~/Documents/memos/" (today) "-" (slugify topic) ".md"))))
```

This one keeps `topic` as a parameter — you want a different topic each time.
But the output path, naming convention, and directory are all baked in.

### GUI Interaction

```
┌─────────────────────────────────────────────┐
│  Research Memo                              │
│                                             │
│  Topic:                                     │
│  ┌─────────────────────────────────────┐    │
│  │ WebAssembly adoption in 2026       │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Output: ~/Documents/memos/2026-03-31-      │
│          webassembly-adoption-in-2026.md     │
│                                             │
│  ┌────────────┐                             │
│  │  Execute   │                             │
│  └────────────┘                             │
└─────────────────────────────────────────────┘
```

This shows the key design principle: **the GUI is a thin wrapper around the
code.** The GUI renders form fields from the module metadata (`__hlvm_meta`). The module
determines what is parameterized and what is hardcoded. The user's personal
binding decides where the slider sits between "always ask" and "always default."

---

## Scenario 7: Scheduled Monitoring

### The Problem

You want to check if your side project's API is healthy, every day, and get a
Slack notification if something is wrong.

### Step 1: The General Function

```lisp
;; health-check.hql
(generable HealthReport {
  status:   (case "healthy" "degraded" "down")
  checks:   [{name: string ok: boolean latency_ms: number}]
  message:  string})

(export (defn health-check [endpoints webhook-url]
  (agent "1. For each endpoint, make an HTTP request
          2. Check status code, response time, response body
          3. If any check fails, send a summary to the webhook URL
          4. Return structured health report"
    {data: {endpoints: endpoints webhook: webhook-url}
     schema: HealthReport
     tools: ["web_fetch"]})))
```

### Step 2: Personal Binding

```lisp
;; my-health.hql
(import {health-check} from "hlvm:@me/health-check")

(export (defn my-health []
  (health-check
    ["https://api.myproject.com/health"
     "https://api.myproject.com/v2/status"]
    "https://hooks.slack.com/services/T.../B.../xxx")))
```

### Step 3: Schedule (Future Capability)

Beyond shortcuts, modules can be scheduled:

```json
{
  "module": "@me/my-health",
  "schedule": "0 9 * * *",
  "note": "Daily 9am health check"
}
```

This is a natural extension of the Hotbar — from "click to run" to "run
automatically." The abstraction ladder extends:

```
health-check.hql        → general purpose, takes endpoints + webhook
    ↓ import + bind
my-health.hql            → personal, zero parameters
    ↓ shortcut
⌘⇧H                    → manual trigger
    ↓ schedule
cron: 0 9 * * *         → fully automated
```

---

## The Design Principle

Every scenario above demonstrates the same architectural truth:

```
Code is the core building block. GUI is a thin wrapper.

The module's (module ...) form declares parameters.
The GUI renders those parameters as a form.
The user fills the form. The module runs.

When the user binds defaults, the form shrinks.
When every parameter is bound, the form disappears.
When the form disappears, it becomes a button.
When the button gets a shortcut, it becomes a reflex.
```

This is NOT a no-code platform. Code is always the source of truth. The GUI
never generates code — it only renders what the code declares. This means:

1. **Version control works.** Your modules are files.
2. **Composition works.** Import one module into another.
3. **Sharing works.** Publish to the Registry.
4. **AI authoring works.** Tell HLVM what you want, it writes the HQL.
5. **Debugging works.** Read the source. It's 3-10 lines.

---

## Why This Is a Killer Feature

### Compared to Shell Scripts

Shell scripts can do the same things. But:

```
Shell script:
  ✗  No GUI. Must remember command + flags.
  ✗  No parameter forms. Must read --help.
  ✗  No composition via imports. Must pipe text.
  ✗  No AI integration. Must add manually.
  ✗  No sharing. Must copy files around.
  ✗  No safety model. chmod +x and pray.

HLVM module:
  ✓  GUI form auto-generated from __hlvm_meta.
  ✓  Parameters are typed and labeled.
  ✓  ESM imports for clean composition.
  ✓  ai() and agent() are first-class.
  ✓  Registry for one-click sharing.
  ✓  Effect system classifies safety level.
```

### Compared to Shortcuts / Automator

macOS Shortcuts and Automator offer GUI automation. But:

```
Shortcuts:
  ✗  Visual block programming. Painful at scale.
  ✗  No real AI integration (just Siri).
  ✗  No autonomous agent capability.
  ✗  No sharing ecosystem.
  ✗  Cannot compose with npm/JSR libraries.
  ✗  Opaque. Cannot version control.

HLVM module:
  ✓  Text-based code. Scales infinitely.
  ✓  Full LLM integration (any provider).
  ✓  Autonomous agents with tools.
  ✓  Registry ecosystem.
  ✓  Entire JavaScript ecosystem available.
  ✓  Plain files. Git-friendly.
```

### Compared to Raycast Extensions

Raycast has extensions and AI. But:

```
Raycast:
  ✗  Extensions are React components (heavy).
  ✗  Must learn their API, bundling, submission.
  ✗  AI is a feature, not a building block.
  ✗  No autonomous agents.
  ✗  Locked to Raycast's UI model.

HLVM module:
  ✓  3-10 lines of HQL.
  ✓  hlvm deploy — one command.
  ✓  AI is the building block (ai(), agent()).
  ✓  Full agent teams with tool access.
  ✓  Standard ESM — runs anywhere.
```

---

## Composition: The Exponential Advantage

The real power is not individual modules — it's composition. Each module
is an ESM import away from being a building block in something larger.

```
┌─────────────────────────────────────────────────────────┐
│                    Composition Tree                       │
│                                                          │
│  my-morning.hql                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │ (export (defn my-morning []                     │     │
│  │   (do                                           │     │
│  │     (await (my-standup))       ; Scenario 2     │     │
│  │     (await (my-review))        ; Scenario 4     │     │
│  │     (await (my-sync))          ; Scenario 3     │     │
│  │     (await (my-health)))))     ; Scenario 7     │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  Press ⌘⇧M at 9:50am.                                   │
│                                                          │
│  Result:                                                 │
│  • Standup report in clipboard                           │
│  • PR reviews prepared for approval                      │
│  • Dependencies synced across repos                      │
│  • API health verified                                   │
│                                                          │
│  Your morning routine. One keystroke. Every day.          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

This is what "daily driver" means. Not a tool you open when you have a special
task. A platform that handles your recurring work, silently, with one keystroke.

---

## The Full Abstraction Stack

```
Layer 0: Raw Capability       ai(), agent(), tools
Layer 1: General Module       commit.hql — parameterized, shareable
Layer 2: Personal Binding     my-commit.hql — zero-param, your defaults
Layer 3: Shortcut             ⌘⇧C — muscle memory
Layer 4: Composition          my-morning.hql — chains multiple bindings
Layer 5: Schedule             cron — fully automated
Layer 6: Event-Driven         on file change, on PR open, on Slack message
```

HLVM enables all six layers. Today we have Layers 0-3 (modules, Hotbar,
shortcuts). Layers 4-5 are straightforward extensions. Layer 6 is the long-term
vision — HLVM as an event-driven automation platform where modules trigger
in response to the world, not just user action.

---

## Summary

The pattern is always the same:

```
1. Write a function.            (code is the building block)
2. Bind your defaults.          (personalize without forking)
3. Assign a shortcut.           (eliminate all friction)
4. Compose into pipelines.      (exponential power)
5. Schedule or trigger.         (remove yourself from the loop)
```

Every step is optional. You can stop at Step 1 and have a useful module on
the Store. Or you can go to Step 5 and have a fully autonomous workflow that
runs while you sleep.

The key insight: **each layer is a one-line HQL file that imports the previous
layer.** There is no new system to learn at each level. It's functions all the
way down.

```
commit.hql                   → 10 lines (general)
my-commit.hql                → 3 lines  (import + bind)
my-morning.hql               → 6 lines  (import + compose)
schedule.json                → 3 lines  (cron entry)
```

This is what a programming-language-as-platform makes possible. Not
drag-and-drop blocks. Not YAML configuration. Not visual flows. Just
functions that import functions. The simplest possible abstraction, repeated
at every level.
# 08 — The Full Execution Pipeline

**The complete lifecycle of an HLVM module (potion): from authoring to every
possible execution channel. Every arrow, every HTTP call, every runtime path.
The definitive reference.**

* it is not final version. you can always raise a question and any contradiction or something off.
  it can be always wrong and incorrectly written and review may have not spotted on any mismatchs that don't make sense at all.
  you can always suggest better approach or architecture or ask questions to clarify - it is now being made - not fully completed.
---

## Terminology

```
Potion    = An HLVM module. A compiled ESM JavaScript module, transpiled from
            HQL source. The atomic unit of the platform. 
            It is nothing but ESM JS module that means it can be written directly in JS.
            It does not have to be written in HQL.

index.hql = The single source file for a potion. Contains both metadata
            (via the (module ...) form) and code. One file = one module.
            Compiles to ONE output: main.js. No separate manifest.

__hlvm_meta = The metadata export embedded in the compiled ESM JavaScript.
              Contains name, description, effect, permissions, params, etc.
              GUI and tooling read THIS — no separate JSON file.

Registry  = JSR (jsr.io) and npm (npmjs.com). HLVM does NOT have its own
            custom registry. Authors publish to existing ecosystems.
            Consumers install from JSR or npm. No custom server.

Launchpad = The full inventory view. Grid of ALL installed potions (superset).
            Every installed potion appears here. 
            You can think of it exactly same as macOS LaunchPad UI, 
            having Portions (ESM Modules), not apps in UI

Hotbar    = The quick-access bar in the macOS GUI. A SUBSET of Launchpad —
            only potions the user has pinned or assigned shortcuts to.
            Store → Install → Launchpad → pin/shortcut → Hotbar.
            It is also exact same UI as HotBar macOS that appears when you press option + tab 

Spotlight = The system-wide REPL/search panel. Think → evaluate → see result. 
            It normally operate like really Spotlight like Apple but it can also play a role in
            input for eval and prompt to ask to AI. the main role of this is to help get non-developer users onboard 
            and get into HLVM system in the form of GUI helping them no need to know all programming knowledge to use
            HLVM systgem as a whole.

Shell     = Any UI surface: macOS GUI, CLI, future Windows/Linux clients.
            The hlvm binary is the core. Shells are thin wrappers. 
            Currently macOS is in development. Other platforms will be coming soon. 
```

---

## THE MODULE FORMAT — One File In, One File Out

A potion is defined in a SINGLE file: `index.hql`. The `(module ...)` form is
always the first expression — metadata lives inside the code. Compiles to a
SINGLE output: `main.js` with metadata embedded as `__hlvm_meta`.

No manifest. No config. No JSON. One file in, one file out.

```
┌─── index.hql — The ONE file ─────────────────────────────────────────────┐
│                                                                           │
│  (module                                     ;; FIRST FORM (metadata)    │
│    {name:        "Multi-Repo Commit"                                      │
│     description: "AI-powered commit across multiple repositories"         │
│     version:     "1.0.0"                                                  │
│     author:      "seoksoon"                                               │
│     icon:        "arrow.triangle.branch"     ;; SF Symbol name           │
│     category:    "developer-tools"                                        │
│     params:      [{name: "directories"                                    │
│                    type: "string[]"                                        │
│                    label: "Repository directories"}]})                     │
│                                                                           │
│  ;; That's it for metadata. No separate manifest needed.                 │
│  ;; Effect and permissions are AUTO-DETECTED by the compiler.            │
│  ;; The compiler sees agent() calls → marks effect: "agent"              │
│  ;; The compiler sees git/shell usage → marks permissions accordingly    │
│                                                                           │
│  (export (fn commit [directories]            ;; THE CODE                 │
│    "Commit all changes in given directories with AI-written messages."    │
│    (for-each directories                                                  │
│      (fn [dir]                                                            │
│        (let [diff   (agent (str "run git diff in " dir                    │
│                              " and summarize what changed"))              │
│              status (agent (str "run git status in " dir))]               │
│          (when (not (empty? diff))                                        │
│            (agent (str "In " dir ":"                                      │
│                       " stage all changes,"                               │
│                       " write a proper conventional commit title"         │
│                       " based on this diff: " diff                       │
│                       " then commit. Skip running tests."))))))))        │
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
│    export function commit(directories) {                                  │
│      for (const dir of directories) {                                     │
│        const diff = await agent(`run git diff in ${dir}...`);            │
│        // ...                                                             │
│      }                                                                    │
│    }                                                                      │
│                                                                           │
│    // The embedded metadata (from (module ...) form + compiler analysis)  │
│    export const __hlvm_meta = {                                           │
│      name: "Multi-Repo Commit",                                           │
│      description: "AI-powered commit across multiple repositories",       │
│      version: "1.0.0",                                                    │
│      author: "seoksoon",                                                  │
│      icon: "arrow.triangle.branch",                                       │
│      category: "developer-tools",                                         │
│      effect: "agent",              // ← auto-detected by compiler        │
│      permissions: ["shell", "git", "filesystem"],  // ← auto-detected   │
│      params: [{ name: "directories", type: "string[]",                   │
│                 label: "Repository directories" }]                        │
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

---

## ACT 1: AUTHOR — User Creates the Module

What the user does: Opens any text editor. Writes ONE file.

```
~/modules/commit/
└── index.hql        ← the ONLY file the user creates
```

That's it. One file. The `(module ...)` form declares what this potion is.
The code below it declares what this potion does. Everything else is generated.

```
┌─── ~/modules/commit/index.hql ───────────────────────────────────────────┐
│                                                                           │
│  (module                                                                  │
│    {name:        "Multi-Repo Commit"                                      │
│     description: "AI-powered commit across multiple repositories"         │
│     version:     "1.0.0"                                                  │
│     author:      "seoksoon"                                               │
│     icon:        "arrow.triangle.branch"                                  │
│     category:    "developer-tools"                                        │
│     params:      [{name: "directories"                                    │
│                    type: "string[]"                                        │
│                    label: "Repository directories"}]})                     │
│                                                                           │
│  (export (fn commit [directories]                                         │
│    "Commit all changes in given directories with AI-written messages."    │
│    (for-each directories                                                  │
│      (fn [dir]                                                            │
│        (let [diff   (agent (str "run git diff in " dir                    │
│                              " and summarize what changed"))              │
│              status (agent (str "run git status in " dir))]               │
│          (when (not (empty? diff))                                        │
│            (agent (str "In " dir ":"                                      │
│                       " stage all changes,"                               │
│                       " write a proper conventional commit title"         │
│                       " based on this diff: " diff                       │
│                       " then commit. Skip running tests."))))))))        │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

What happens when the user builds:

```
┌─── The Compilation Pipeline (7-stage) ───────────────────────────────────┐
│                                                                           │
│  $ hlvm build ~/modules/commit                                            │
│        │                                                                  │
│        ▼                                                                  │
│  ┌── Stage 1: PARSE ──────────────────────────────────────────────────┐   │
│  │ Reader reads index.hql → S-expression AST                          │   │
│  │ (module ...) form extracted as metadata                            │   │
│  │ Remaining forms are the module body                                │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│        │                                                                  │
│        ▼                                                                  │
│  ┌── Stage 2: MACROEXPAND ────────────────────────────────────────────┐   │
│  │ Expand macros (defmacro, syntax-quote, etc.)                       │   │
│  │ Resolve imports (hlvm:, npm:, relative)                            │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│        │                                                                  │
│        ▼                                                                  │
│  ┌── Stage 3: TRANSFORM ─────────────────────────────────────────────┐   │
│  │ AST → IR (intermediate representation)                             │   │
│  │ Desugar special forms (let, cond, do, etc.)                        │   │
│  │ Resolve bindings                                                   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│        │                                                                  │
│        ▼                                                                  │
│  ┌── Stage 4: EFFECT CHECK ──────────────────────────────────────────┐   │
│  │ Static analysis of the IR:                                         │   │
│  │ - Detects agent() calls    → effect: "agent"                       │   │
│  │ - Detects ai() calls       → effect: "ai"                         │   │
│  │ - Detects fetch/fs calls   → effect: "io"                         │   │
│  │ - No side effects          → effect: "pure"                        │   │
│  │                                                                    │   │
│  │ Auto-derives permissions:                                          │   │
│  │ - agent() + git diff       → permissions: ["shell", "git"]        │   │
│  │ - agent() + filesystem     → permissions: ["filesystem"]           │   │
│  │ - Combined                 → ["shell", "git", "filesystem"]        │   │
│  │                                                                    │   │
│  │ USER NEVER DECLARES THESE. Compiler infers them.                   │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│        │                                                                  │
│        ▼                                                                  │
│  ┌── Stage 5: CODEGEN ───────────────────────────────────────────────┐   │
│  │ IR → JavaScript (standard ESM)                                     │   │
│  │ Emits: export function commit(directories) { ... }                 │   │
│  │ Emits: export const __hlvm_meta = { ... }                          │   │
│  │   (module metadata + auto-detected effect + permissions)           │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│        │                                                                  │
│        ▼                                                                  │
│  ┌── Stage 6: SOURCE MAP ────────────────────────────────────────────┐   │
│  │ V3-compliant source map: main.js ↔ index.hql                      │   │
│  │ Line + column mapping for debugging                                │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│        │                                                                  │
│        ▼                                                                  │
│  ┌── Stage 7: OUTPUT ────────────────────────────────────────────────┐   │
│  │ Write main.js (code + __hlvm_meta — everything in one file)        │   │
│  │ Write main.js.map (source map)                                     │   │
│  │ No separate manifest. The JS IS the module.                        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  Output:                                                                  │
│  ~/modules/commit/                                                        │
│  ├── index.hql            (source — user wrote this)                      │
│  └── dist/                                                                │
│      ├── main.js          (compiled ESM — code + metadata bundled)        │
│      └── main.js.map      (source map)                                    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## ACT 2: DEPLOY — Build + Deliver

Three verbs. That is the entire CLI model:

```
hlvm run    — just works (auto-compiles if needed)
hlvm build  — compile only (inspect/debug)
hlvm deploy — build + deliver (default: local, --jsr, --npm)
```

`hlvm deploy` is the unified command. No flags = local install. Flags add
remote publishing on top of local install. Remote deploy ALWAYS includes
local install too.

**Deploy locally (default — no flags):**

```
┌─── Terminal ────────────────────────────────────────────────────────────┐
│                                                                         │
│  $ hlvm deploy                                                          │
│                                                                         │
│    Compiling index.hql → main.js .............. done                   │
│    Effect detected: agent                                               │
│    Deployed locally to ~/.hlvm/modules/@local/commit/                   │
│                                                                         │
│    Ready to use through all execution channels.                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Deploy to JSR (also installs locally):**

```
┌─── Terminal ────────────────────────────────────────────────────────────┐
│                                                                         │
│  $ hlvm deploy --jsr                                                    │
│                                                                         │
│    Compiling index.hql → main.js .............. done                   │
│    Deployed locally to ~/.hlvm/modules/@local/commit/                   │
│    Published to jsr.io/@seoksoon/commit@1.0.0                          │
│                                                                         │
│    Others can install: hlvm install jsr:@seoksoon/commit               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Deploy to npm (also installs locally):**

```
┌─── Terminal ────────────────────────────────────────────────────────────┐
│                                                                         │
│  $ hlvm deploy --npm                                                    │
│                                                                         │
│    Compiling index.hql → main.js .............. done                   │
│    Deployed locally to ~/.hlvm/modules/@local/commit/                   │
│    Published to npmjs.com/@seoksoon/commit@1.0.0                       │
│                                                                         │
│    Others can install: hlvm install npm:@seoksoon/commit               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

What happens inside the binary:

```
$ hlvm deploy [--jsr | --npm]
      │
      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  Step 1: COMPILE (same 7-stage pipeline as `hlvm build`)                │
│     index.hql → dist/main.js (code + __hlvm_meta bundled)               │
│     Effect checker → auto-detects effect + permissions                   │
│                                                                          │
│  Step 2: DELIVER (destination varies by flag)                            │
│                                                                          │
│     ┌─── Delivery Targets ───────────────────────────────────────────┐  │
│     │                                                                 │  │
│     │  (no flag):  local only                                        │  │
│     │    Save to ~/.hlvm/modules/@local/<name>/                      │  │
│     │    Register in local module index                              │  │
│     │    Add to Launchpad                                            │  │
│     │                                                                 │  │
│     │  --jsr:  local + JSR                                           │  │
│     │    All of the above, PLUS:                                     │  │
│     │    Publish to jsr.io/@<author>/<name>                          │  │
│     │                                                                 │  │
│     │  --npm:  local + npm                                           │  │
│     │    All of the above, PLUS:                                     │  │
│     │    Publish to npmjs.com/@<author>/<name>                       │  │
│     │                                                                 │  │
│     └─────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  KEY DESIGN DECISIONS:                                                   │
│  - No custom hlvm/registry. Use existing ecosystems (JSR, npm).          │
│  - Remote publish ALWAYS includes local install.                         │
│  - `hlvm deploy` with no flags replaces the old `hlvm install --local`. │
│  - The compiled dist/main.js is standard ESM. Not proprietary.           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**The critical output:** `dist/main.js` is a **standard ESM JavaScript module**
with metadata baked in. Not proprietary. Not HLVM-specific bytecode. Just
JavaScript with a `__hlvm_meta` export. This is what makes every execution
channel in Act 4 possible.

Local modules live in:

```
~/.hlvm/modules/@local/commit/
  └── main.js        (compiled ESM — code + __hlvm_meta bundled)
```

Perfect for:
- Personal automation (my-commit, my-deploy, etc.)
- Work in progress (test locally before publishing)
- Private/proprietary modules (company internal tools)

---

## ACT 3: INSTALL — Another User Gets the Module

What the user sees in the macOS GUI:

```
┌─── HLVM Module Store View ──────────────────────────────────────────────┐
│                                                                          │
│  User clicks "Store" tab in the HLVM macOS app.                          │
│  Types "commit" in search.                                               │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ Q  commit                                                        │    │
│  ├──────────────────────────────────────────────────────────────────┤    │
│  │                                                                  │    │
│  │  Multi-Repo Commit               @seoksoon       ● Agent        │    │
│  │  "AI-powered commit across repos"          Install               │    │
│  │                                                                  │    │
│  │  Smart Commit                     @devtools       ● AI           │    │
│  │  "Single repo AI commit messages"          Install               │    │
│  │                                                                  │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  User clicks "Multi-Repo Commit" → detail view shows metadata            │
│  read from __hlvm_meta in the compiled ESM module.                       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                                                                  │    │
│  │  Multi-Repo Commit                                       v1.0.0 │    │
│  │  by @seoksoon                                                    │    │
│  │                                                                  │    │
│  │  AI-powered commit across multiple repositories.                 │    │
│  │  Reads diffs, writes conventional commit messages,               │    │
│  │  stages and commits. Skips tests.                                │    │
│  │                                                                  │    │
│  │  ┌────────────────────────────────────────────────────────────┐  │    │
│  │  │  Effect:       ● Agent (full system access)                │  │    │
│  │  │  Permissions:  shell, git, filesystem                      │  │    │
│  │  │  Input:        directories (string array)                  │  │    │
│  │  │  Source:       github.com/seoksoon/hlvm-modules            │  │    │
│  │  └────────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  │                 ┌──────────────────┐                              │    │
│  │                 │     Install      │                              │    │
│  │                 └──────────────────┘                              │    │
│  │                                                                  │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  User clicks Install → permission dialog → Allow.                        │
│  Module downloads. Icon appears in Launchpad (all installed potions).    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

What happens inside:

```
User clicks "Install"
      │
      ▼
┌─── macOS GUI (Swift) ──────────────────────────────────────────────────┐
│                                                                         │
│  1. Swift shows permission dialog (rendered from module metadata)       │
│     "Multi-Repo Commit needs: shell, git, filesystem access."          │
│  2. User clicks "Allow"                                                 │
│  3. Swift sends HTTP request:                                           │
│                                                                         │
│     POST http://127.0.0.1:11435/api/store/install                      │
│     Authorization: Bearer <auth-token>                                  │
│     Body: { "module": "@seoksoon/commit", "version": "1.0.0" }        │
│                                                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─── hlvm binary (Deno) ────────────────────────────────────────────────┐
│                                                                        │
│  1. RESOLVE from JSR or npm                                            │
│     Query jsr.io or npmjs.com for the package                          │
│     → resolve version, download URL, integrity hash                    │
│                                                                        │
│  2. DOWNLOAD from JSR/npm                                              │
│     Fetch main.js (code + __hlvm_meta bundled in ONE file)             │
│     → verify integrity hash                                            │
│                                                                        │
│  3. SAVE to local module directory                                     │
│     ~/.hlvm/modules/@seoksoon/commit/1.0.0/                            │
│       └── main.js          (the ONE compiled file)                     │
│     ~/.hlvm/modules/@seoksoon/commit/current → 1.0.0/ (symlink)       │
│                                                                        │
│  4. READ METADATA from the module itself                               │
│     import { __hlvm_meta } from "./main.js"                            │
│     → name, effect, permissions, params, icon — all from __hlvm_meta  │
│     → register in local module index (~/.hlvm/modules/index.json)      │
│     → add to Launchpad (all installed potions live here)               │
│                                                                        │
│  5. RESPOND                                                            │
│     { "ok": true, "module": "@seoksoon/commit", "version": "1.0.0" } │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

CLI install (no GUI needed):

```
┌─── Terminal ────────────────────────────────────────────────────────────┐
│                                                                         │
│  // Install from JSR                                                    │
│  $ hlvm install jsr:@seoksoon/commit                                   │
│                                                                         │
│    Resolving jsr:@seoksoon/commit@latest ......... 1.0.0              │
│    Downloading from jsr.io ...................... done (4.2 KB)        │
│    Verifying integrity .......................... match                │
│    Reading __hlvm_meta .......................... done                  │
│    Installed to ~/.hlvm/modules/@seoksoon/commit/1.0.0/               │
│    Added to Launchpad.                                                 │
│                                                                         │
│  // Install from npm                                                    │
│  $ hlvm install npm:@seoksoon/commit                                   │
│                                                                         │
│  // Install a specific version                                          │
│  $ hlvm install jsr:@seoksoon/commit@1.0.0                             │
│                                                                         │
│  // Search JSR/npm                                                      │
│  $ hlvm search commit                                                  │
│    @seoksoon/commit    "AI-powered commit across repos"    v1.0.0     │
│    @devtools/commit    "Single repo AI commit"             v2.3.1     │
│                                                                         │
│  // Update all modules                                                  │
│  $ hlvm update                                                          │
│    Checking JSR/npm for updates...                                      │
│    @seoksoon/commit: 1.0.0 → 1.1.0 .............. updated            │
│    my-commit: local (deploy to update)                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ACT 4: EXECUTE — All Eight Channels

**This is the critical act.** A potion is a standard ESM JavaScript module.
The hlvm binary is the core runtime. The GUI is just one thin client. A potion
can be executed through **every channel that can run JavaScript or reach the
hlvm binary.**

### The Execution Channel Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                         EXECUTION CHANNELS                              │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ 1. GUI       │  │ 2. CLI       │  │ 3. REPL      │                  │
│  │    Launchpad/ │  │    hlvm run  │  │    hlvm repl │                  │
│  │    Hotbar     │  │              │  │              │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                 │                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ 4. Global    │  │ 5. Direct    │  │ 6. HTTP      │                  │
│  │    Eval      │  │    ESM       │  │    API       │                  │
│  │  (nREPL-like │  │  deno / node │  │  curl /      │                  │
│  │   anywhere)  │  │  / bun       │  │  any client  │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                 │                 │                           │
│  ┌──────────────┐  ┌──────────────┐                                    │
│  │ 7. Program-  │  │ 8. Agent     │                                    │
│  │    matic     │  │    Invocation│                                    │
│  │  import()    │  │  ai.agent()  │                                    │
│  └──────┬───────┘  └──────┬───────┘                                    │
│         │                 │                                            │
│         └────────┬────────┘                                            │
│                  │                                                      │
│                  ▼                                                      │
│    ┌──────────────────────────────────────────────────────────┐        │
│    │                                                          │        │
│    │           hlvm binary — the universal runtime            │        │
│    │                                                          │        │
│    │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │        │
│    │  │  Module   │  │  Agent   │  │  HQL     │              │        │
│    │  │  Runner   │  │  Engine  │  │Transpiler│              │        │
│    │  └──────────┘  └──────────┘  └──────────┘              │        │
│    │                                                          │        │
│    │  All channels converge here. One runtime. Many shells.  │        │
│    │                                                          │        │
│    └──────────────────────────────────────────────────────────┘        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Channel 1: GUI — Launchpad / Hotbar Click

The macOS app is the friendliest channel. For users who prefer visual interaction.
Launchpad shows ALL installed potions. Hotbar shows a frequently-used subset
(potions the user has registered shortcuts for or pinned).

```
User clicks "Cmit" in Launchpad (or Hotbar if pinned)
      │
      ▼
┌─── macOS GUI (Swift) ──────────────────────────────────────────────────┐
│                                                                         │
│  GUI reads __hlvm_meta from the module → sees params: [directories]    │
│  params is non-empty → GUI shows a generic alert (one text field per   │
│  param, comma separator for array types):                               │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  Multi-Repo Commit                                               │   │
│  │                                                                  │   │
│  │  directories:                                                    │   │
│  │  ┌──────────────────────────────────────────────────────────┐    │   │
│  │  │ ~/dev/HLVM, ~/dev/hql                                    │    │   │
│  │  └──────────────────────────────────────────────────────────┘    │   │
│  │                                                                  │   │
│  │     ┌──────────┐  ┌──────────┐                                  │   │
│  │     │  Cancel   │  │   Run    │                                  │   │
│  │     └──────────┘  └──────────┘                                  │   │
│  │                                                                  │   │
│  │  Rule: one text field per param. Label = param name.             │   │
│  │  Arrays: comma-separated values (split on ",").                  │   │
│  │  Zero params = NO alert = instant run.                           │   │
│  │  Fancy type-aware widgets can layer on later as optional hints.  │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  User fills form, clicks "Run":                                         │
│                                                                         │
│  POST http://127.0.0.1:11435/api/modules/run                          │
│  Authorization: Bearer <token>                                          │
│  Body: {                                                                │
│    "module": "@seoksoon/commit",                                       │
│    "args": { "directories": ["~/dev/HLVM", "~/dev/hql"] }             │
│  }                                                                      │
│  Response: NDJSON stream (same as /api/chat)                            │
│                                                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
                    (continues to Agent Engine below)
```

---

### Channel 2: CLI — `hlvm run`

No GUI needed. The binary IS the runtime.

```
┌─── Terminal ────────────────────────────────────────────────────────────┐
│                                                                         │
│  // Run a registered potion by name                                     │
│  $ hlvm run @seoksoon/commit \                                          │
│      --directories '["~/dev/HLVM", "~/dev/hql"]'                       │
│                                                                         │
│  // Run a local HQL file directly (no install needed)                   │
│  $ hlvm run ~/modules/commit/index.hql \                               │
│      --directories '["~/dev/HLVM", "~/dev/hql"]'                       │
│                                                                         │
│  // Run an HQL expression inline                                        │
│  $ hlvm run '(commit ["~/dev/HLVM" "~/dev/hql"])'                      │
│                                                                         │
│  // Run the compiled ESM directly                                       │
│  $ hlvm run ~/.hlvm/modules/@seoksoon/commit/current/main.js \         │
│      --directories '["~/dev/HLVM", "~/dev/hql"]'                       │
│                                                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─── hlvm binary — run command ──────────────────────────────────────────┐
│                                                                         │
│  cli.ts routes "run" to run.ts:                                         │
│                                                                         │
│  1. DETECT input type:                                                  │
│     - S-expression?  → HQL expression evaluation                        │
│     - .hql file?     → compile (7-stage) + execute                      │
│     - .js/.ts file?  → dynamic import                                   │
│     - @name?         → resolve from module registry                     │
│                                                                         │
│  2. EXECUTE:                                                            │
│     HQL: transpileToJavascript() → inject runtime helpers → eval        │
│     JS:  import(fileUrl) → call exported function                       │
│     Registered: resolve path → import(ESM) → call with args            │
│                                                                         │
│  3. OUTPUT:                                                             │
│     Results printed to stdout                                           │
│     Agent events streamed to stderr (if --verbose)                      │
│                                                                         │
│  No HTTP server involved. Direct in-process execution.                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Channel 3: REPL — Interactive Evaluation

The REPL is a persistent session where you can import, compose, and execute
potions interactively.

```
┌─── Terminal ────────────────────────────────────────────────────────────┐
│                                                                         │
│  $ hlvm repl                                                            │
│                                                                         │
│  HLVM v1.0.0 · llama3.1:8b · 107 stdlib functions                     │
│  Type HQL expressions, /help for commands                               │
│                                                                         │
│  hlvm> (import [commit] from "hlvm:@seoksoon/commit")                  │
│  ;; => imported: commit                                                 │
│                                                                         │
│  hlvm> (commit ["~/dev/HLVM" "~/dev/hql"])                             │
│  ;; Agent running...                                                    │
│  ;; [git_diff] ~/dev/HLVM: 3 files changed                            │
│  ;; [shell_exec] git add -A                                            │
│  ;; [shell_exec] git commit -m "feat(gui): ..."                        │
│  ;; [git_diff] ~/dev/hql: 1 file changed                              │
│  ;; [shell_exec] git add -A                                            │
│  ;; [shell_exec] git commit -m "fix(store): ..."                       │
│  ;; => ["committed ~/dev/HLVM", "committed ~/dev/hql"]                 │
│                                                                         │
│  hlvm> (def my-dirs ["~/dev/HLVM" "~/dev/hql" "~/dev/dotfiles"])       │
│  hlvm> (commit my-dirs)                                                 │
│  ;; => runs against 3 repos                                             │
│                                                                         │
│  hlvm> (fn my-commit [] (commit my-dirs))                              │
│  hlvm> (my-commit)                                                      │
│  ;; => same thing, zero params                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

The REPL evaluator routes input through:

```
┌─── REPL Input Router ──────────────────────────────────────────────────┐
│                                                                         │
│  User types input                                                       │
│       │                                                                 │
│       ├── S-expression (...)  → HQL evaluator                           │
│       │   └── transpile → execute → return result                       │
│       │                                                                 │
│       ├── (js "code")         → JS evaluator                            │
│       │   └── evaluate raw JavaScript → return result                   │
│       │                                                                 │
│       ├── /command            → Slash command handler                    │
│       │   └── built-in REPL commands (/help, /clear, /model, etc.)     │
│       │                                                                 │
│       └── plain text          → AI conversation                         │
│           └── route to agent engine (natural language → tool calls)     │
│                                                                         │
│  The REPL is a full environment:                                        │
│  - Persistent state (defs carry across inputs)                          │
│  - Import resolution (hlvm:, npm:, relative paths)                     │
│  - History (up/down arrows, searchable)                                 │
│  - Session persistence (--resume to continue later)                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Channel 4: Global Eval — nREPL for the Entire OS

**This is the most powerful channel.** Like Clojure's nREPL + Calva, but not
limited to a code editor. HLVM runs as a background daemon. Anywhere on macOS
where there is keyboard input, you can evaluate HQL.

```
┌─── HOW IT WORKS ───────────────────────────────────────────────────────┐
│                                                                         │
│  HLVM.app runs as a menu bar app (background daemon).                   │
│  The hlvm binary HTTP server is always listening on localhost:11435.     │
│  Global keyboard shortcuts are registered system-wide.                  │
│                                                                         │
│  The user is ANYWHERE on macOS:                                         │
│  - In a text editor (VS Code, Vim, TextEdit)                            │
│  - In a browser (writing a comment, reading docs)                       │
│  - In Terminal (working in another project)                              │
│  - In Notes, Slack, any app with text input                             │
│  - Even in Finder                                                       │
│                                                                         │
│  FLOW:                                                                  │
│                                                                         │
│  1. User writes or selects HQL text:                                    │
│     (commit ["~/dev/HLVM" "~/dev/hql"])                                │
│                                                                         │
│  2. User presses global eval shortcut: Cmd+Enter                        │
│                                                                         │
│  3. HLVM captures the global hotkey                                     │
│                                                                         │
│  4. Reads the selected text (from clipboard or accessibility API)       │
│                                                                         │
│  5. Sends to the binary:                                                │
│     POST http://127.0.0.1:11435/api/eval                               │
│     Body: { "code": "(commit [\"~/dev/HLVM\" \"~/dev/hql\"])" }       │
│     Response: NDJSON stream                                             │
│                                                                         │
│  6. Binary evaluates the HQL (same pipeline as REPL):                   │
│     transpile → execute → agent() calls → tool calls → result          │
│                                                                         │
│  7. Result displayed as floating notification:                           │
│                                                                         │
│     ┌──────────────────────────────────────────┐                        │
│     │  ✓ Eval Complete                         │                        │
│     │                                          │                        │
│     │  ~/dev/HLVM → feat(gui): update store    │                        │
│     │  ~/dev/hql  → fix(agent): timeout bug    │                        │
│     │                                          │                        │
│     │                        [Dismiss]         │                        │
│     └──────────────────────────────────────────┘                        │
│                                                                         │
│  Auto-dismiss after 5 seconds.                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

The scope of global eval is **much wider** than registered potions:

```
┌─── WHAT GLOBAL EVAL CAN EXECUTE ───────────────────────────────────────┐
│                                                                         │
│  REGISTERED POTIONS (installed modules in Launchpad):                    │
│    (my-commit)                                                          │
│    (my-standup)                                                         │
│    (my-deploy)                                                          │
│                                                                         │
│  AD-HOC HQL EXPRESSIONS (anything):                                     │
│    (+ 1 2)                                                              │
│    (map inc [1 2 3])                                                    │
│    (ai "what is the weather in Seoul?")                                 │
│    (agent "refactor main.ts to use async/await")                        │
│    (let [x 42] (* x x))                                                │
│                                                                         │
│  IMPORTS + CALLS (compose on the fly):                                  │
│    (do                                                                  │
│      (import [commit] from "hlvm:@seoksoon/commit")                    │
│      (import [push] from "hlvm:@seoksoon/push")                        │
│      (commit ["~/dev/hql"])                                             │
│      (push ["~/dev/hql"]))                                              │
│                                                                         │
│  RAW JAVASCRIPT (via js form):                                          │
│    (js "console.log(Date.now())")                                       │
│    (js "await fetch('https://api.example.com/data')")                  │
│                                                                         │
│  This is not just "run a button."                                       │
│  This is "evaluate any code, anywhere, instantly."                      │
│  The entire HQL runtime is at your fingertips system-wide.              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

The system diagram for global eval:

```
┌──── Any macOS App ──────────────────────────────┐
│                                                   │
│  User selects text:                               │
│  (commit ["~/dev/HLVM" "~/dev/hql"])             │
│                                                   │
│  User presses Cmd+Enter                           │
│                                                   │
└───────────────────────┬───────────────────────────┘
                        │
                        ▼
┌──── HLVM.app (background daemon) ────────────────┐
│                                                    │
│  KeyboardManager captures global hotkey            │
│  DesktopObserver reads selected text               │
│  (clipboard or accessibility API)                  │
│                                                    │
│  POST localhost:11435/api/eval                     │
│  Body: { code: <selected text> }                   │
│                                                    │
└───────────────────────┬────────────────────────────┘
                        │
                        ▼
┌──── hlvm binary ─────────────────────────────────┐
│                                                    │
│  /api/eval handler:                                │
│  1. Parse HQL input                                │
│  2. Transpile → JavaScript                         │
│  3. Execute (may trigger agent() / ai() calls)     │
│  4. Stream results via NDJSON                      │
│                                                    │
└───────────────────────┬────────────────────────────┘
                        │
                        ▼
┌──── HLVM.app (floating result) ──────────────────┐
│                                                    │
│  Reads NDJSON stream                               │
│  Renders floating result notification              │
│  Auto-dismiss or click to expand                   │
│                                                    │
└──────────────────────────────────────────────────┘
```

---

### Channel 5: Direct ESM — deno / node / bun

The compiled potion is a **standard ESM JavaScript module**. It runs in ANY
JavaScript runtime. No HLVM needed.

```
┌─── Terminal ────────────────────────────────────────────────────────────┐
│                                                                         │
│  // The compiled output is just JavaScript:                             │
│  $ cat ~/.hlvm/modules/@seoksoon/commit/current/main.js                │
│                                                                         │
│  export function commit(directories) {                                  │
│    // ... transpiled from HQL, calls agent() etc.                       │
│  }                                                                      │
│  export const __hlvm_meta = { effect: "agent", ... };                  │
│                                                                         │
│  // Run with Deno (HLVM's native runtime):                              │
│  $ deno run -A main.js                                                  │
│                                                                         │
│  // Run with Node.js:                                                   │
│  $ node --experimental-vm-modules main.js                               │
│                                                                         │
│  // Run with Bun:                                                       │
│  $ bun run main.js                                                      │
│                                                                         │
│  // Import as a library in your own project:                            │
│  $ cat my-script.ts                                                     │
│  import { commit } from "./main.js";                                    │
│  await commit(["~/dev/HLVM", "~/dev/hql"]);                            │
│                                                                         │
│  $ deno run -A my-script.ts                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Important constraint:** When the potion uses `agent()` or `ai()`, those
functions require the HLVM runtime (providers, tool registry, etc.). For pure
potions (effect: "pure"), direct ESM execution works anywhere with zero
dependencies. For agent potions, the HLVM runtime must be available — either
via `hlvm run` or by importing the runtime shim.

```
┌─── Effect → Portability Matrix ────────────────────────────────────────┐
│                                                                         │
│  Effect     │ Deno │ Node │ Bun │ Browser │ HLVM │ Notes               │
│  ───────────┼──────┼──────┼─────┼─────────┼──────┼──────────────────── │
│  pure       │  ✓   │  ✓   │  ✓  │    ✓    │  ✓   │ Zero deps, runs    │
│             │      │      │     │         │      │ everywhere           │
│  ai         │  ~   │  ~   │  ~  │    ~    │  ✓   │ Needs LLM provider  │
│             │      │      │     │         │      │ config               │
│  agent      │  ~   │  ~   │  ~  │    x    │  ✓   │ Needs full runtime  │
│             │      │      │     │         │      │ (tools, shell, etc.) │
│                                                                         │
│  ✓ = works out of the box                                               │
│  ~ = works with runtime shim or provider setup                          │
│  x = not possible (requires OS-level access)                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Channel 6: HTTP API — Any Client

The hlvm binary exposes an HTTP API on localhost:11435. ANY HTTP client can
invoke potions. This is what the GUI uses, but it's not exclusive to the GUI.

```
┌─── Terminal / Script / Another App ────────────────────────────────────┐
│                                                                         │
│  // Evaluate HQL expression via HTTP                                    │
│  $ curl -X POST http://127.0.0.1:11435/api/eval \                     │
│      -H "Authorization: Bearer $HLVM_AUTH_TOKEN" \                     │
│      -H "Content-Type: application/json" \                             │
│      -d '{"code": "(commit [\"~/dev/HLVM\" \"~/dev/hql\"])"}'         │
│                                                                         │
│  // Run a registered module                                             │
│  $ curl -X POST http://127.0.0.1:11435/api/modules/run \              │
│      -H "Authorization: Bearer $HLVM_AUTH_TOKEN" \                     │
│      -H "Content-Type: application/json" \                             │
│      -d '{"module":"@seoksoon/commit",                                 │
│           "args":{"directories":["~/dev/HLVM","~/dev/hql"]}}'         │
│                                                                         │
│  // Chat mode (agent handles the rest)                                  │
│  $ curl -X POST http://127.0.0.1:11435/api/chat \                     │
│      -H "Authorization: Bearer $HLVM_AUTH_TOKEN" \                     │
│      -H "Content-Type: application/json" \                             │
│      -d '{"mode":"agent",                                              │
│           "messages":[{"role":"user",                                   │
│             "content":"commit all changes in ~/dev/HLVM and ~/dev/hql  │
│              with AI-written messages"}]}'                              │
│                                                                         │
│  Response: NDJSON stream                                                │
│  {"event":"tool","name":"git_diff","status":"running"}                 │
│  {"event":"tool","name":"git_diff","status":"done","summary":"..."}    │
│  {"event":"token","text":"Committed successfully..."}                  │
│  {"event":"complete","results":[...]}                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

HTTP API endpoints relevant to module execution:

```
┌─── HTTP Endpoints ─────────────────────────────────────────────────────┐
│                                                                         │
│  Endpoint                     │ Method │ Purpose                        │
│  ─────────────────────────────┼────────┼─────────────────────────────── │
│  /api/eval                    │  POST  │ Evaluate HQL/JS expression    │
│  /api/modules/run             │  POST  │ Execute a registered module   │
│  /api/modules/list            │  GET   │ List installed modules        │
│  /api/store/search            │  GET   │ Search the registry           │
│  /api/store/install           │  POST  │ Install from registry         │
│  /api/chat                    │  POST  │ Chat/Agent/Eval (mode param) │
│  /api/chat/stream             │  GET   │ SSE subscription for events  │
│  /api/chat/cancel             │  POST  │ Cancel running execution     │
│  /api/memory/functions        │  GET   │ List available bindings       │
│  /api/memory/functions/execute│  POST  │ Execute binding by name      │
│  /api/completions             │  POST  │ Code completion suggestions  │
│  /health                      │  GET   │ Server health + auth token   │
│                                                                         │
│  Auth: Bearer token (UUID generated at server start, from /health)     │
│  Port: 11435 (SSOT with Swift GUI)                                      │
│  CORS: localhost only                                                   │
│  Streaming: NDJSON (line-delimited JSON)                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Channel 7: Programmatic Import

Since potions are ESM, they are first-class JavaScript libraries. Any project
can import them.

```
┌─── Another Project's Code ─────────────────────────────────────────────┐
│                                                                         │
│  // In any Deno/Node/Bun project:                                       │
│                                                                         │
│  import { commit } from "hlvm:@seoksoon/commit";                       │
│  // or: import { commit } from "~/.hlvm/modules/@seoksoon/.../main.js" │
│                                                                         │
│  // Use it as a normal function                                         │
│  const results = await commit(["~/dev/HLVM", "~/dev/hql"]);           │
│                                                                         │
│  // Compose it with your own logic                                      │
│  async function deployAll() {                                           │
│    await commit(["~/dev/HLVM", "~/dev/hql"]);                          │
│    await push(["~/dev/HLVM", "~/dev/hql"]);                            │
│    await notify("Deployed to production");                              │
│  }                                                                      │
│                                                                         │
│  // Use in a CI/CD pipeline (GitHub Actions, etc.)                      │
│  // - install hlvm runtime                                              │
│  // - import the module                                                 │
│  // - call the function                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Channel 8: Agent Invocation

Within the HLVM agent system, potions can be invoked by the AI itself — either
through the `ai.agent()` HQL API or when the agent autonomously decides to
call a registered module as a tool.

```
┌─── REPL or any HQL context ───────────────────────────────────────────┐
│                                                                         │
│  ;; Tell the agent what to do in natural language                       │
│  ;; The agent has access to registered potions as tools                 │
│                                                                         │
│  (ai.agent "Commit all my changes in HLVM and hql repos,              │
│             then push to remote, then post a summary to Slack.")       │
│                                                                         │
│  ;; The agent's ReAct loop:                                             │
│  ;;                                                                     │
│  ;; Iteration 1: "I should use the commit module"                       │
│  ;;   → tool call: @seoksoon/commit(["~/dev/HLVM", "~/dev/hql"])       │
│  ;;                                                                     │
│  ;; Iteration 2: "Now I need to push"                                   │
│  ;;   → tool call: shell_exec("cd ~/dev/HLVM && git push")            │
│  ;;   → tool call: shell_exec("cd ~/dev/hql && git push")             │
│  ;;                                                                     │
│  ;; Iteration 3: "Now notify Slack"                                     │
│  ;;   → tool call: web_fetch(slack_webhook, summary)                   │
│  ;;                                                                     │
│  ;; => "Done. Committed and pushed 2 repos, notified #dev channel."    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### The Agent Engine (Common to All Channels)

Regardless of which channel triggered execution, when a potion calls `agent()`,
it enters the same Agent Engine:

```
┌─── hlvm binary — Agent Engine (for EACH agent() call) ─────────────────┐
│                                                                          │
│  agent("run git diff in ~/dev/HLVM and summarize what changed")         │
│       │                                                                  │
│       ▼                                                                  │
│  ┌── ReAct Loop (orchestrator.ts) ──────────────────────────────────┐   │
│  │                                                                   │   │
│  │  Iteration 1: LLM reasons about the task                         │   │
│  │    → Decides: I need to run git diff                              │   │
│  │    → Tool call: git_diff { directory: "~/dev/HLVM" }             │   │
│  │                                                                   │   │
│  │  Iteration 2: LLM sees the diff output                           │   │
│  │    → Reasons: These changes modify SwiftUI views and add a       │   │
│  │      new Store panel. I should summarize this.                    │   │
│  │    → Returns: "Modified StoreView.swift, added ModuleGrid,       │   │
│  │      updated HotbarView with new module slot rendering"          │   │
│  │                                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  The ReAct loop is the SAME regardless of how the potion was invoked:   │
│  - GUI click → agent()  → ReAct loop                                    │
│  - CLI run   → agent()  → ReAct loop                                    │
│  - REPL eval → agent()  → ReAct loop                                    │
│  - Global eval → agent() → ReAct loop                                   │
│  - HTTP API  → agent()  → ReAct loop                                    │
│  - ESM import → agent() → ReAct loop                                    │
│                                                                          │
│  All roads lead to the same Agent Engine.                                │
│                                                                          │
│  Progress events stream back via NDJSON (when HTTP) or callbacks:       │
│                                                                          │
│  {"event":"tool","name":"git_diff","status":"running"}                  │
│  {"event":"tool","name":"git_diff","status":"done","summary":"..."}     │
│  {"event":"token","text":"Analyzing changes..."}                        │
│  {"event":"tool","name":"shell_exec","status":"running"}                │
│  {"event":"tool","name":"shell_exec","status":"done"}                   │
│  {"event":"progress","repo":"~/dev/HLVM","status":"committed"}          │
│  {"event":"complete","results":[...]}                                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## ACT 5: BIND — User Creates Personal Zero-Param Version

What the user does: Creates a SINGLE file that wraps the first module.

```
┌─── ~/modules/my-commit/index.hql ────────────────────────────────────┐
│                                                                       │
│  (module                                                              │
│    {name:        "My Commit"                                          │
│     description: "Commit HLVM + hql repos"                           │
│     version:     "1.0.0"                                              │
│     icon:        "checkmark.circle.fill"                              │
│     params:      []})          ;; EMPTY. No form needed. A button.   │
│                                                                       │
│  (import [commit] from "hlvm:@seoksoon/commit")                      │
│                                                                       │
│  (export (fn my-commit []                                             │
│    "My daily commit across HLVM and hql repos."                      │
│    (commit ["~/dev/HLVM" "~/dev/hql"])))                             │
│                                                                       │
│  ;; That's it. 10 lines. One file.                                    │
│  ;; The compiler auto-detects: effect "agent", perms ["shell","git"] │
│  ;; because it follows the import chain and sees agent() calls.       │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

Deploy locally (no registry needed for personal modules):

```
┌─── Terminal ────────────────────────────────────────────────────────────┐
│                                                                         │
│  $ cd ~/modules/my-commit                                               │
│  $ hlvm deploy                                                          │
│                                                                         │
│    Compiling index.hql → main.js .............. done                   │
│    Effect detected: agent (follows import chain)                        │
│    Deployed locally as my-commit                                        │
│    Added to Launchpad.                                                  │
│                                                                         │
│    Ready. Click to run — no parameters needed.                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**The binding changes behavior across ALL channels:**

```
┌─── BEFORE (commit, with params) ───────────────────────────────────────┐
│                                                                         │
│  GUI:         Form appears → user must type directories → click Run    │
│  CLI:         hlvm run @seoksoon/commit --directories '[...]'          │
│  REPL:        (commit ["~/dev/HLVM" "~/dev/hql"])                      │
│  Global Eval: must type full expression with args                       │
│                                                                         │
├─── AFTER (my-commit, zero params) ─────────────────────────────────────┤
│                                                                         │
│  GUI:         NO FORM. Click = immediate execute.                       │
│  CLI:         hlvm run my-commit                                       │
│  REPL:        (my-commit)                                               │
│  Global Eval: select "(my-commit)" → Cmd+Enter → done                  │
│                                                                         │
│  Every channel gets simpler when params are bound.                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ACT 6: SHORTCUT — Keyboard Shortcut Assignment

```
┌─── User right-clicks "MyCm" in Launchpad ────────────────────────────┐
│                                                                       │
│  ┌──────────────────────────┐                                         │
│  │  Run                     │                                         │
│  │  Assign Shortcut...      │  ← Assigns shortcut AND pins to Hotbar │
│  │  Pin to Hotbar           │  ← Just pins (no shortcut)             │
│  │  Uninstall               │                                         │
│  └──────────────────────────┘                                         │
│                                                                       │
│  User clicks "Assign Shortcut..." → presses Cmd+Shift+C              │
│  Saved to ~/.hlvm/shortcuts.json                                      │
│  Automatically pinned to Hotbar.                                      │
│                                                                       │
│  Swift GUI registers global hotkey Cmd+Shift+C → my-commit           │
│  KeyboardManager (AppKit global event monitor) captures it anywhere.  │
│                                                                       │
│  FLOW SUMMARY:                                                        │
│  Store → Install → Launchpad → pin/shortcut → Hotbar                 │
│                                                                       │
│  Launchpad = ALL installed (superset, searchable, scrollable grid)    │
│  Hotbar = PINNED subset (always visible, quick access, shortcuts)    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## ACT 7: GLOBAL EVAL — nREPL for Your Entire Operating System

This is where HLVM transcends being "an app" and becomes a **system-wide
programmable intelligence layer.**

### The Spotlight Panel as REPL

The Spotlight panel (Cmd+Space or configured hotkey) is both a search interface
AND a REPL:

```
┌─── User presses Cmd+Space ──────────────────────────────────────────┐
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                                                                │   │
│  │  Q  (map inc [1 2 3 4 5])                                     │   │
│  │                                                                │   │
│  │  ───────────────────────────────────────────────────────────   │   │
│  │                                                                │   │
│  │  Result: [2 3 4 5 6]                                          │   │
│  │                                                                │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                                                                │   │
│  │  Q  (my-commit)                                                │   │
│  │                                                                │   │
│  │  ───────────────────────────────────────────────────────────   │   │
│  │                                                                │   │
│  │  ● Running agent...                                           │   │
│  │    ├── git_diff ~/dev/HLVM ................... done           │   │
│  │    ├── git_diff ~/dev/hql .................... done           │   │
│  │    ├── Committing ~/dev/HLVM ................. done           │   │
│  │    └── Committing ~/dev/hql .................. done           │   │
│  │                                                                │   │
│  │  ✓ 2 repos committed                                         │   │
│  │                                                                │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Grab-and-Eval: Evaluate Code from Any App

The truly unique capability — evaluate HQL from ANYWHERE:

```
┌─── User is in VS Code, editing a markdown file ────────────────────────┐
│                                                                         │
│  The user sees this text in their editor:                               │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  # TODO                                                          │   │
│  │  Need to commit changes.                                         │   │
│  │                                                                  │   │
│  │  >(my-commit)<     ← user selects this text                      │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  User presses Cmd+Enter (global eval shortcut)                          │
│                                                                         │
│  HLVM.app (background daemon) captures the hotkey:                      │
│  1. KeyboardManager detects Cmd+Enter                                   │
│  2. Reads selected text from active app (accessibility/clipboard)       │
│  3. POST localhost:11435/api/eval { code: "(my-commit)" }             │
│  4. Binary evaluates it                                                 │
│  5. Floating result appears over the current app:                       │
│                                                                         │
│     ┌──────────────────────────────────────────┐                        │
│     │  ✓ (my-commit)                           │                        │
│     │  2 repos committed                       │                        │
│     └──────────────────────────────────────────┘                        │
│                                                                         │
│  This works in ANY app: VS Code, Safari, Notes, Terminal, Slack, etc.  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### The Companion as Ambient Intelligence

Beyond user-triggered eval, the Companion mode observes and suggests:

```
┌─── Companion Mode (Ambient) ───────────────────────────────────────────┐
│                                                                         │
│  HLVM.app observes via DesktopObserver:                                 │
│    - Active window title                                                │
│    - Focused application                                                │
│    - Clipboard contents                                                 │
│                                                                         │
│  POST localhost:11435/api/companion/observe                             │
│  Body: {                                                                │
│    "windowTitle": "hql — ~/dev/hql — VS Code",                         │
│    "appName": "Code",                                                   │
│    "clipboard": "git diff --stat"                                       │
│  }                                                                      │
│                                                                         │
│  The companion engine MAY proactively suggest:                          │
│                                                                         │
│  SSE event via /api/companion/stream:                                   │
│  {                                                                      │
│    "type": "suggestion",                                                │
│    "content": "You have uncommitted changes in 2 repos.                │
│                Run (my-commit)?",                                       │
│    "action": "(my-commit)"                                              │
│  }                                                                      │
│                                                                         │
│  GUI shows subtle notification:                                         │
│                                                                         │
│  ┌──────────────────────────────────────────┐                           │
│  │  2 repos have uncommitted changes.       │                           │
│  │     ┌──────────┐  ┌──────────┐           │                           │
│  │     │  Commit   │  │ Dismiss  │           │                           │
│  │     └──────────┘  └──────────┘           │                           │
│  └──────────────────────────────────────────┘                           │
│                                                                         │
│  User clicks "Commit" → executes (my-commit) → same pipeline.          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ACT 8: DAILY USE — All Channels in Practice

### Scenario A: Keyboard Shortcut (fastest, muscle memory)

```
┌─── User presses Cmd+Shift+C anywhere on macOS ──────────────────────┐
│                                                                       │
│  Time: 0.0s → 0.05s                                                  │
│                                                                       │
│  macOS captures global hotkey → HLVM app activates                    │
│  Hotkey handler looks up Cmd+Shift+C in ~/.hlvm/shortcuts.json       │
│  Maps to: my-commit                                                   │
│  Reads __hlvm_meta: params:[] → no form needed                        │
│                                                                       │
│  POST http://127.0.0.1:11435/api/modules/run                        │
│  { "module": "my-commit", "args": {} }                               │
│                                                                       │
│  Time: 0.1s → ~15s                                                    │
│                                                                       │
│  Binary executes: load ESM → call my-commit() → commit([...])       │
│  → agent() x3 per directory → ReAct loops → git operations            │
│                                                                       │
│  Time: ~15s                                                           │
│                                                                       │
│  Floating result:                                                     │
│  ┌──────────────────────────────────────────┐                         │
│  │  ✓ My Commit                   ✓ Done   │                         │
│  │  ~/dev/HLVM → feat(gui): ...            │                         │
│  │  ~/dev/hql  → fix(store): ...           │                         │
│  └──────────────────────────────────────────┘                         │
│  Auto-dismiss after 5 seconds.                                        │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Scenario B: Global Eval (ad-hoc, from any app)

```
┌─── User is reading code in a browser, writes in a scratch pad ────────┐
│                                                                        │
│  User writes in Notes.app:                                             │
│                                                                        │
│    (do                                                                 │
│      (import [commit] from "hlvm:@seoksoon/commit")                   │
│      (import [push] from "hlvm:@seoksoon/push")                       │
│      (commit ["~/dev/HLVM" "~/dev/hql"])                              │
│      (push ["~/dev/HLVM" "~/dev/hql"]))                               │
│                                                                        │
│  Selects all → presses Cmd+Enter                                       │
│                                                                        │
│  HLVM evaluates the entire block.                                      │
│  Commits both repos. Pushes both repos. Shows floating result.         │
│                                                                        │
│  The user composed two potions on the fly, in a note-taking app.       │
│  No terminal. No IDE. Just text and a keyboard shortcut.               │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Scenario C: CLI in a script (automation, CI/CD)

```
┌─── deploy.sh ──────────────────────────────────────────────────────────┐
│                                                                         │
│  #!/bin/bash                                                            │
│                                                                         │
│  # End-of-day automation script                                         │
│  hlvm run my-commit                                                    │
│  hlvm run my-push                                                      │
│  hlvm run my-notify --message "EOD deploy complete"                    │
│                                                                         │
│  # Or as a single HQL expression:                                       │
│  hlvm run '(do (my-commit) (my-push) (my-notify "EOD deploy"))'       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Scenario D: REPL for exploration and prototyping

```
┌─── hlvm repl ──────────────────────────────────────────────────────────┐
│                                                                         │
│  hlvm> (import [commit] from "hlvm:@seoksoon/commit")                  │
│  hlvm> (import [standup] from "hlvm:@seoksoon/standup")                │
│                                                                         │
│  ;; Test the commit on just one repo first                              │
│  hlvm> (commit ["~/dev/hql"])                                           │
│  ;; => "committed: fix(types): narrow union type"                       │
│                                                                         │
│  ;; Looks good. Now compose a morning routine interactively:            │
│  hlvm> (fn morning []                                                   │
│           (do (standup ["~/dev/HLVM" "~/dev/hql"] "seoksoon")          │
│               (commit ["~/dev/HLVM" "~/dev/hql"])))                    │
│                                                                         │
│  ;; Test it                                                             │
│  hlvm> (morning)                                                        │
│  ;; => standup report + commits                                         │
│                                                                         │
│  ;; Happy with it? Save as a module:                                    │
│  hlvm> /save morning ~/modules/my-morning/index.hql                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Scenario E: Programmatic import in another project

```
┌─── ~/dev/my-ci-tool/deploy.ts ─────────────────────────────────────────┐
│                                                                         │
│  import { commit } from "hlvm:@seoksoon/commit";                       │
│  import { healthCheck } from "hlvm:@seoksoon/health-check";            │
│                                                                         │
│  async function deploy() {                                              │
│    // Pre-deploy health check                                           │
│    const health = await healthCheck(["https://api.prod.com/health"]);  │
│    if (health.status !== "healthy") {                                   │
│      throw new Error("Pre-deploy health check failed");                │
│    }                                                                    │
│                                                                         │
│    // Commit and push                                                   │
│    await commit(["~/dev/my-project"]);                                  │
│                                                                         │
│    // ... rest of deploy logic                                          │
│  }                                                                      │
│                                                                         │
│  // Run with: deno run -A deploy.ts                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Scenario F: Agent orchestration (AI-driven workflows)

```
┌─── Agent composes potions autonomously ──────────────────────────────┐
│                                                                       │
│  $ hlvm ask "End of day: commit all my repos, push, and summarize    │
│              what I did today into a standup note for tomorrow."      │
│                                                                       │
│  Agent's ReAct loop:                                                  │
│                                                                       │
│  Iteration 1: "I'll use the commit potion for all repos"             │
│    → tool: @seoksoon/commit(["~/dev/HLVM","~/dev/hql","~/dotfiles"]) │
│    → result: 3 repos committed                                        │
│                                                                       │
│  Iteration 2: "Now push all repos"                                    │
│    → tool: shell_exec("cd ~/dev/HLVM && git push")                   │
│    → tool: shell_exec("cd ~/dev/hql && git push")                    │
│    → tool: shell_exec("cd ~/dotfiles && git push")                   │
│                                                                       │
│  Iteration 3: "Generate standup summary"                              │
│    → tool: @seoksoon/standup(...)                                     │
│    → tool: write_file("~/notes/standup-2026-03-31.md", summary)      │
│                                                                       │
│  Result: "Done. Committed and pushed 3 repos. Standup note saved."   │
│                                                                       │
│  The agent treated potions as tools — first-class, discoverable,      │
│  composable. The human just described the intent.                     │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## MODULE RESOLUTION — How `hlvm:@seoksoon/commit` Becomes JavaScript

```
┌─── Resolution Pipeline ──────────────────────────────────────────────┐
│                                                                       │
│  (import [commit] from "hlvm:@seoksoon/commit")                      │
│                                    │                                  │
│                                    ▼                                  │
│  ┌── Step 1: Parse the specifier ──────────────────────────────┐     │
│  │  Protocol: "hlvm:"                                           │     │
│  │  Scope: "@seoksoon"                                          │     │
│  │  Name: "commit"                                              │     │
│  │  Version: "current" (latest installed)                       │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                    │                                  │
│                                    ▼                                  │
│  ┌── Step 2: Resolve to local path ────────────────────────────┐     │
│  │  Look up in ~/.hlvm/modules/index.json                       │     │
│  │  Found: @seoksoon/commit → version 1.0.0                    │     │
│  │  Path: ~/.hlvm/modules/@seoksoon/commit/current/main.js     │     │
│  │  (current is a symlink to 1.0.0/)                            │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                    │                                  │
│                                    ▼                                  │
│  ┌── Step 3: Dynamic import ───────────────────────────────────┐     │
│  │  const mod = await import("file://~/.hlvm/modules/...")      │     │
│  │  return mod.commit  // the exported function                 │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                                                       │
│  OTHER SPECIFIER FORMATS:                                             │
│                                                                       │
│  "hlvm:@seoksoon/commit@1.0.0"   → specific version                 │
│  "hlvm:my-commit"                → local module                      │
│  "./main.js"                     → relative path (standard ESM)      │
│  "npm:lodash"                    → npm package (via Deno)            │
│  "jsr:@std/path"                 → JSR package (via Deno)            │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## THE COMPLETE DATA FLOW — All Channels Converging

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                    ╔═══════════════════════════╗                         │
│                    ║    EXECUTION CHANNELS     ║                         │
│                    ╚═══════════════════════════╝                         │
│                                                                         │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │ GUI     │  │ CLI      │  │ REPL     │  │ Global   │                │
│  │Launchpad│  │ hlvm run │  │ hlvm repl│  │ Eval     │                │
│  │ Click   │  │          │  │          │  │ Cmd+Enter│                │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘                │
│       │            │             │              │                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │ Direct  │  │ HTTP     │  │ Program- │  │ Agent    │                │
│  │ ESM     │  │ API      │  │ matic    │  │ Invoke   │                │
│  │ deno /  │  │ curl /   │  │ import() │  │ ai.agent │                │
│  │ node    │  │ script   │  │          │  │          │                │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘                │
│       │            │             │              │                       │
│       └────────────┴──────┬──────┴──────────────┘                      │
│                           │                                            │
│                           ▼                                            │
│       ╔═══════════════════════════════════════════════════╗             │
│       ║                                                   ║             │
│       ║        hlvm binary — the universal runtime        ║             │
│       ║                                                   ║             │
│       ║  1. RESOLVE: find the module (registry / file)    ║             │
│       ║  2. LOAD: dynamic import of ESM module            ║             │
│       ║  3. READ: __hlvm_meta for permissions + params    ║             │
│       ║  4. VALIDATE: check permissions, verify args      ║             │
│       ║  5. EXECUTE: call exported function                ║             │
│       ║                                                   ║             │
│       ║     If function calls agent():                    ║             │
│       ║     ┌── ReAct Loop ────────────────────────┐      ║             │
│       ║     │ LLM reasons → tool call → observe    │      ║             │
│       ║     │ → reason again → tool call → ...     │      ║             │
│       ║     │ → final answer                       │      ║             │
│       ║     └──────────────────────────────────────┘      ║             │
│       ║                                                   ║             │
│       ║     If function calls ai():                       ║             │
│       ║     ┌── LLM Call ──────────────────────────┐      ║             │
│       ║     │ Single-turn prompt → response        │      ║             │
│       ║     └──────────────────────────────────────┘      ║             │
│       ║                                                   ║             │
│       ║     If function is pure:                          ║             │
│       ║     ┌── Direct Execution ──────────────────┐      ║             │
│       ║     │ JavaScript runs → return value       │      ║             │
│       ║     └──────────────────────────────────────┘      ║             │
│       ║                                                   ║             │
│       ╚═══════════════════════════════════════════════════╝             │
│                           │                                            │
│                           ▼                                            │
│                  ┌─────────────────┐                                   │
│                  │    PROVIDERS    │                                   │
│                  ├─────────────────┤                                   │
│                  │ Ollama (local)  │                                   │
│                  │ OpenAI (cloud)  │                                   │
│                  │ Anthropic       │                                   │
│                  │ Google          │                                   │
│                  │ MCP Servers     │                                   │
│                  └─────────────────┘                                   │
│                                                                         │
│                                                                         │
│                    ╔═══════════════════════════╗                         │
│                    ║    RESULT RENDERING       ║                         │
│                    ╚═══════════════════════════╝                         │
│                                                                         │
│  GUI:          NDJSON stream → live progress → floating notification   │
│  CLI:          stdout (default) / NDJSON (--verbose)                   │
│  REPL:         inline result with formatting                           │
│  Global Eval:  floating notification over current app                  │
│  Direct ESM:   return value to calling code                            │
│  HTTP API:     NDJSON stream to client                                 │
│  Programmatic: Promise<result> to importing code                       │
│  Agent:        result feeds back into ReAct loop                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## THE ABSTRACTION LADDER

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  LAYER        WHAT USER WRITES         EXECUTION CHANNELS    FRICTION  │
│  ─────        ────────────────         ──────────────────    ────────  │
│                                                                         │
│  General      (module {params: [...]}) All 8 channels:       Low      │
│  module       (fn commit [dirs]        GUI form, CLI args,            │
│                 (for-each dirs ...))   REPL call, etc.                │
│               ← shareable, on registry                                │
│                 ONE FILE (index.hql)                                    │
│                                                                         │
│       │                                                                 │
│       │ bind params                                                     │
│       ▼                                                                 │
│                                                                         │
│  Personal     (module {params: []})    All 8 channels:       Lower    │
│  binding      (fn my-commit []         GUI button (no form),          │
│                 (commit [...]))        CLI (no args), REPL           │
│               ← local, ONE FILE         (no args), global eval        │
│                 10 lines                 (5 chars), etc.               │
│                                                                         │
│       │                                                                 │
│       │ assign shortcut                                                 │
│       ▼                                                                 │
│                                                                         │
│  Shortcut     Cmd+Shift+C → my-commit Keystroke only.       Zero     │
│               ← no GUI needed,         Floating progress              │
│                 muscle memory           notification.                  │
│                                                                         │
│       │                                                                 │
│       │ global eval                                                     │
│       ▼                                                                 │
│                                                                         │
│  System-wide  Select text anywhere     Any app on macOS.     Zero     │
│  eval         → Cmd+Enter             Write HQL in Notes,   (wider   │
│               ← nREPL for the OS       VS Code, browser,     scope)   │
│                                        Slack — evaluate it.           │
│                 Not limited to                                         │
│                 registered potions.     Can run ANY HQL               │
│                 Full runtime access.    expression.                    │
│                                                                         │
│       │                                                                 │
│       │ compose                                                         │
│       ▼                                                                 │
│                                                                         │
│  Pipeline     (fn my-evening []        All 8 channels.       Zero     │
│                (do (my-commit)         One button/keystroke            │
│                    (my-push)           runs the entire                 │
│                    (my-notify)))       pipeline.                       │
│               ← chains modules                                         │
│                                                                         │
│       │                                                                 │
│       │ schedule / event                                                │
│       ▼                                                                 │
│                                                                         │
│  Automated    cron: 0 18 * * *         No human trigger.     None     │
│               on: file_change          Runs autonomously.             │
│               on: pr_open              The ultimate form:              │
│               ← fully autonomous       human removed from loop.       │
│                                                                         │
│                                                                         │
│  At each step: code is the source of truth.                             │
│  GUI reads __hlvm_meta from the compiled ESM itself.                    │
│  When params:[] → form disappears → icon becomes instant button.        │
│  The binary is always the runtime. Shells are interchangeable.          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## THE DISTRIBUTION MODEL — JSR + npm (No Custom Registry)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                    ╔═══════════════════════════╗                         │
│                    ║  EXISTING ECOSYSTEMS ONLY  ║                        │
│                    ╚═══════════════════════════╝                         │
│                                                                         │
│  HLVM does NOT maintain a custom registry. Authors publish to           │
│  existing package ecosystems. Consumers install from them.              │
│                                                                         │
│  ┌─── JSR (jsr.io) ─────────────────────────────────────────────────┐  │
│  │  jsr.io/@seoksoon/commit                                          │  │
│  │  jsr.io/@seoksoon/standup                                         │  │
│  │  jsr.io/@devtools/commit                                          │  │
│  │                                                                    │  │
│  │  Publish: hlvm deploy --jsr                                       │  │
│  │  Install: hlvm install jsr:@seoksoon/commit                       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─── npm (npmjs.com) ──────────────────────────────────────────────┐  │
│  │  npmjs.com/@seoksoon/commit                                       │  │
│  │  npmjs.com/@seoksoon/push                                         │  │
│  │                                                                    │  │
│  │  Publish: hlvm deploy --npm                                       │  │
│  │  Install: hlvm install npm:@seoksoon/commit                       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  Note: The module's full metadata (effect, permissions, params) comes   │
│  from __hlvm_meta inside the compiled main.js itself — self-describing. │
│  No separate manifest needed anywhere in the pipeline.                  │
│                                                                         │
│                                                                         │
│  WORKFLOW:                                                              │
│                                                                         │
│  Author                            Ecosystem                            │
│  ──────                            ─────────                            │
│  writes index.hql                                                       │
│  runs hlvm deploy [--jsr | --npm]                                       │
│    ├── compiles to main.js (code + __hlvm_meta bundled)                 │
│    ├── saves to ~/.hlvm/modules/@local/<name>/ (always)                 │
│    └── publishes to JSR or npm (if flag given)                          │
│                                                                         │
│  Module discoverable via hlvm search / GUI Store                        │
│  (Store searches JSR and/or npm)                                        │
│                                                                         │
│                                                                         │
│  Consumer                           JSR / npm                           │
│  ────────                           ─────────                           │
│  runs hlvm install jsr:@seoksoon/commit                                 │
│    ├── resolves from jsr.io (or npmjs.com)                              │
│    ├── downloads main.js                                                │
│    ├── verifies integrity                                               │
│    ├── reads __hlvm_meta from main.js (self-describing)                 │
│    └── saves to ~/.hlvm/modules/                                        │
│                                                                         │
│                                                                         │
│  WHY THIS MODEL:                                                        │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ - Zero infrastructure to maintain (use existing registries)    │     │
│  │ - Proven at massive scale: JSR and npm already work            │     │
│  │ - Standard tooling: authors already know npm/JSR publish       │     │
│  │ - No vendor lock-in. No custom server. No custom protocol.     │     │
│  │ - Module is SELF-DESCRIBING via __hlvm_meta — no separate      │     │
│  │   manifest needed anywhere in the pipeline.                    │     │
│  │ - Potions are standard ESM — they ARE npm/JSR packages.        │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## THE ARCHITECTURAL TRUTH

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                                                                         │
│                     hlvm binary (~/dev/hql)                             │
│                     ═══════════════════════                             │
│                                                                         │
│                     This is the CORE. The runtime.                      │
│                     HQL compiler, agent engine, module runner,          │
│                     tool registry, memory system, providers.            │
│                     Everything lives here.                              │
│                                                                         │
│                     It exposes:                                          │
│                     - CLI commands (hlvm run, hlvm ask, hlvm repl)      │
│                     - HTTP API (localhost:11435)                         │
│                     - ESM modules (standard JavaScript)                 │
│                                                                         │
│                                                                         │
│                            │                                            │
│              ┌─────────────┼─────────────┐                              │
│              │             │             │                              │
│              ▼             ▼             ▼                              │
│                                                                         │
│    macOS GUI           Terminal       Any JS Runtime                    │
│   (~/dev/HLVM)         (CLI)          (Deno/Node/Bun)                  │
│   ════════════         ════════       ═══════════════                   │
│                                                                         │
│   SwiftUI thin         $ hlvm run     import { fn }                    │
│   shell. Launchpad     $ hlvm repl      from "module"                  │
│   (all installed),     $ hlvm ask                                      │
│   Hotbar (pinned),     $ curl API     Standard ESM.                    │
│   Spotlight,                          No HLVM needed                   │
│   Chat window.         Direct.        for pure modules.                │
│                        In-process.                                     │
│   Talks to binary      No HTTP.                                        │
│   via HTTP.                                                            │
│                                                                         │
│   Reads __hlvm_meta                                                    │
│   for GUI rendering.                                                   │
│                                                                         │
│                                                                         │
│   ┌────────────────────────────────────────────────────────────┐       │
│   │                                                            │       │
│   │  The GUI is ONE shell among many. Not privileged.          │       │
│   │  The CLI is another shell. Direct ESM is another.          │       │
│   │  HTTP API enables any future shell: Windows, Linux, web.   │       │
│   │                                                            │       │
│   │  The binary is the brain. Shells are fingers.              │       │
│   │                                                            │       │
│   └────────────────────────────────────────────────────────────┘       │
│                                                                         │
│                                                                         │
│   The unique combination:                                               │
│                                                                         │
│   1. Potions are standard ESM → portable to any JS environment         │
│   2. Single-file authoring → one index.hql, compiler does the rest     │
│   3. Self-describing → __hlvm_meta baked into the JS, no manifest      │
│   4. JSR + npm → no custom registry, use existing ecosystems            │
│   5. Binary provides the runtime → agent(), ai(), tools                │
│   6. GUI provides the UX → Launchpad, Hotbar, alerts, shortcuts        │
│   7. Global eval provides the reach → any app, any text, Cmd+Enter     │
│   8. Companion provides the intelligence → ambient, proactive          │
│                                                                         │
│   No other platform has all eight.                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## SUMMARY: The Eight Execution Channels

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  #  CHANNEL          TRIGGER              WHO IT'S FOR                  │
│  ── ─────────────    ──────────────────   ──────────────────────────── │
│                                                                         │
│  1  GUI Click        Launchpad (all)      Non-technical users.         │
│                      / Hotbar (pinned)    Visual, discoverable.         │
│                                                                         │
│  2  CLI Run          $ hlvm run           Developers, scripts,         │
│                                           CI/CD pipelines.              │
│                                                                         │
│  3  REPL             $ hlvm repl          Exploration, prototyping,    │
│                      → type expression    interactive development.      │
│                                                                         │
│  4  Global Eval      Select text in any   Power users. The nREPL      │
│                      app → Cmd+Enter      experience, system-wide.     │
│                                           ANY HQL, not just potions.   │
│                                                                         │
│  5  Direct ESM       $ deno run main.js   Maximum portability.         │
│                      $ node main.js       No HLVM dependency for       │
│                      $ bun run main.js    pure modules.                │
│                                                                         │
│  6  HTTP API         POST /api/eval       Integration with other       │
│                      POST /api/modules/   apps, services, tools.       │
│                      run                  Any HTTP client.             │
│                                                                         │
│  7  Programmatic     import { fn }        Library-style usage.         │
│     Import           from "module"        Composition in larger        │
│                                           projects.                     │
│                                                                         │
│  8  Agent            (ai.agent "...")      AI-driven invocation.       │
│     Invocation       Agent calls potion   Potions as agent tools.      │
│                      as a tool.           Autonomous workflows.        │
│                                                                         │
│                                                                         │
│  ALL CHANNELS → SAME BINARY → SAME ENGINE → SAME RESULT               │
│                                                                         │
│  The potion doesn't know how it was invoked.                           │
│  The runtime doesn't care which shell triggered it.                    │
│  One function. Eight ways to call it. Zero inconsistency.              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## COMPLETE LIFECYCLE — One Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  1. AUTHOR ─────────────────────────────────────────────────────────    │
│     User writes ONE file: index.hql                                     │
│     (module {name: "..." params: [...]})                                │
│     (export (fn myFn [...] ...))                                        │
│                                                                         │
│  2. BUILD ──────────────────────────────────────────────────────────    │
│     hlvm build → 7-stage compiler:                                      │
│     Parse → Macroexpand → Transform → Effect Check → Codegen →         │
│     Source Map → Output                                                 │
│     Output: ONE file — main.js (code + __hlvm_meta bundled)             │
│     Effect + permissions AUTO-DETECTED (never declared by user)         │
│     No manifest. No JSON. Self-describing ESM.                          │
│                                                                         │
│  3. DEPLOY ──────────────────────────────────────────────────────────    │
│     hlvm deploy →                                                       │
│       a. Compile (same as build)                                        │
│       b. Install locally to ~/.hlvm/modules/                            │
│     hlvm deploy --jsr → also publish to JSR                             │
│     hlvm deploy --npm → also publish to npm                             │
│     No custom registry. Use existing ecosystems (JSR, npm).             │
│                                                                         │
│  4. INSTALL ────────────────────────────────────────────────────────    │
│     hlvm install jsr:@author/name (or npm:@author/name) →              │
│       a. Fetch from JSR or npm                                          │
│       b. Download main.js                                               │
│       c. Verify integrity                                               │
│       d. Read __hlvm_meta from the module itself                        │
│       e. Save to ~/.hlvm/modules/ + add to Launchpad                   │
│     OR: GUI Store tab → search → click Install → same pipeline          │
│                                                                         │
│  5. EXECUTE (8 channels) ───────────────────────────────────────────    │
│     GUI click │ CLI run │ REPL │ Global Eval │ Direct ESM │ HTTP │      │
│     Programmatic import │ Agent invocation                              │
│     ALL → same binary → same engine → same result                       │
│                                                                         │
│  6. BIND (optional) ────────────────────────────────────────────────    │
│     Create a zero-param wrapper (another index.hql, 10 lines)           │
│     hlvm deploy → appears in Launchpad as instant button                │
│                                                                         │
│  7. SHORTCUT (optional) ────────────────────────────────────────────    │
│     Right-click in Launchpad → Assign Shortcut → Cmd+Shift+C           │
│     Automatically pinned to Hotbar                                      │
│     System-wide hotkey registered via AppKit                            │
│                                                                         │
│  8. AMBIENT (optional) ─────────────────────────────────────────────    │
│     Companion mode observes → suggests actions → user approves          │
│     Global eval: select any text → Cmd+Enter → instant evaluation       │
│     Spotlight panel: type HQL → see result → full nREPL for macOS       │
│                                                                         │
│                                                                         │
│  THE PROGRESSION:                                                       │
│                                                                         │
│  index.hql → main.js (self-describing ESM) → installed →               │
│  Launchpad → Hotbar → keyboard shortcut → muscle memory →               │
│  ambient intelligence                                                   │
│                                                                         │
│  From "I wrote a function" to "it runs when I think about it."          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```
