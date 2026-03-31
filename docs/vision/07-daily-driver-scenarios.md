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
     tools: ["shell_exec" "web_search"]})))
```

### Step 2: Personal Binding

```lisp
;; my-standup.hql
(import {standup} from "hlvm:@me/standup")

(export (defn my-standup []
  (standup
    ["~/dev/HLVM" "~/dev/hql" "~/dev/infra"]
    "seoksoonjang")))
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
     tools: ["shell_exec" "web_search" "read_file"]})))
```

### Step 2: Personal Binding + GUI Approval

```lisp
;; my-review.hql
(import {review-prs} from "hlvm:@me/review-prs")

(export (defn my-review []
  (review-prs
    ["hlvm-org/hql" "hlvm-org/HLVM" "hlvm-org/infra"]
    "seoksoonjang")))
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
     tools: ["web_search" "web_fetch" "write_file"]})))
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
