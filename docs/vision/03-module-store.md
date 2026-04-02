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
