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
