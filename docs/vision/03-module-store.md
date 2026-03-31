# 03 — The Module Registry

**The Git-based registry: design, requirements, trust model, and flywheel.**

---

## Why a Central Registry Is Critical (Not Optional)

Without a central registry:

```
┌──────────────────────────────────────────┐
│  User writes HQL module                  │
│  User uses it locally                    │
│  User shares it... how?                  │
│                                          │
│  "Hey, I made a cool module"             │
│  "Cool, how do I get it?"                │
│  "Clone my GitHub repo, then run..."     │
│  "Never mind."                           │
│                                          │
│  DEAD. No ecosystem. No network effect.  │
│  Just a local scripting tool.            │
│  Glorified bash alias.                   │
└──────────────────────────────────────────┘
```

With a central registry:

```
┌──────────────────────────────────────────┐
│  User writes HQL module                  │
│  $ hlvm deploy                           │
│  Module appears in Registry for ALL users│
│                                          │
│  Other users search → install → use →    │
│  star → more users find it → author      │
│  writes more → ecosystem grows →         │
│  more users join →                       │
│                                          │
│  NETWORK EFFECT. Flywheel.               │
│  This is how npm, Homebrew, Docker Hub   │
│  all became dominant.                    │
└──────────────────────────────────────────┘
```

The relationship:

```
Local tool:     You write, you use.          Value = linear.
Platform:       You write, everyone uses.    Value = exponential.
```

Every successful developer ecosystem has a central registry:

```
Platform             Registry               Without it?
────────            ─────────              ──────────────────
Node.js         →   NPM                   Just another runtime
Python          →   PyPI                  Just another language
Ruby            →   RubyGems              Just another language
Rust            →   crates.io             Just another language
Docker          →   Docker Hub            Just another VM tool
iOS             →   App Store             Just another phone
VS Code         →   Extension Market      Just another editor
Homebrew        →   homebrew-core         Just another pkg mgr

HLVM            →   hlvm/registry         Just another AI tool
                    (BUILD THIS)
```

**NPM made Node.js dominant. Not the other way around.** The registry IS the
moat. It IS the product.

But a registry does NOT require a central server. Homebrew proved this: its
registry (`homebrew-core`) is a Git repo on GitHub. No database. No API server.
No CDN. Just a repo full of metadata files. HLVM follows the same model.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│               HLVM Module Registry (Homebrew Model)                     │
│                                                                         │
│  The "registry" is a Git repository: github.com/hlvm/registry           │
│  It contains ONLY JSON metadata files. NO code. NO binaries.            │
│  Authors host their own code anywhere they choose.                      │
│                                                                         │
│  ┌─── hlvm/registry (Git repo) ────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  modules/                                                        │   │
│  │  ├── h/hlvm/                                                     │   │
│  │  │   ├── sentiment.json      ← pointer to @hlvm's hosting       │   │
│  │  │   └── summarize.json      ← pointer to @hlvm's hosting       │   │
│  │  ├── j/jane/                                                     │   │
│  │  │   └── competitor-monitor.json  ← pointer to jane's hosting   │   │
│  │  ├── s/seoksoon/                                                 │   │
│  │  │   └── commit.json         ← pointer to seoksoon's hosting    │   │
│  │  └── b/bob/                                                      │   │
│  │      └── csv-formatter.json  ← pointer to bob's hosting         │   │
│  │                                                                  │   │
│  │  Each JSON file contains:                                        │   │
│  │    - Module name, author, description                            │   │
│  │    - Per-version: download URL + sha256 + size                   │   │
│  │    - That's it. Just pointers.                                   │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│         ▲                                              ▲                │
│         │ PR to add/update                             │ git clone /    │
│         │ module entry                                 │ raw JSON fetch │
│         │                                              │                │
│  ┌──────┴─────────┐                           ┌───────┴────────┐       │
│  │  hlvm deploy   │                           │  hlvm install  │       │
│  │  (author)      │                           │  hlvm search   │       │
│  │                │                           │  (user)        │       │
│  │  1. Compile    │                           │                │       │
│  │  2. Upload to  │                           │  1. Read JSON  │       │
│  │     own hosting│                           │  2. Download   │       │
│  │  3. PR to      │                           │     from author│       │
│  │     registry   │                           │  3. Verify     │       │
│  └────────────────┘                           │     sha256     │       │
│                                               │  4. Save to    │       │
│         Code lives on author's hosting:       │     ~/.hlvm/   │       │
│         - GitHub Releases                     │  5. Add to     │       │
│         - JSR                                 │     Launchpad  │       │
│         - npm                                 └────────────────┘       │
│         - Any HTTP URL                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

Compare with a central server model:

  Central server:    Server + DB + CDN + API + auth + monitoring + $$$
  Git registry:      One Git repo. Zero servers. Zero cost. MIT licensed.

  Homebrew serves 6,000+ packages this way. It works.
```

---

## What the Registry Stores vs What the Module Contains

The registry and the module have separate, complementary roles. The registry
stores pointers. The module describes itself.

### Registry JSON (what hlvm/registry stores per module)

```
┌─── modules/j/jane/competitor-monitor.json ──────────────────────────┐
│                                                                      │
│  {                                                                   │
│    "name": "Competitor Monitor",                                     │
│    "author": "jane",                                                 │
│    "description": "Track competitor pricing changes",                │
│    "category": "monitoring",                                         │
│    "versions": {                                                     │
│      "2.0.0": {                                                      │
│        "url": "github.com/jane/hlvm-modules/releases/.../main.js",  │
│        "sha256": "a1b2c3d4e5f6...",                                  │
│        "size": 4200                                                  │
│      },                                                              │
│      "1.3.1": {                                                      │
│        "url": "github.com/jane/hlvm-modules/releases/.../main.js",  │
│        "sha256": "b2c3d4e5f6a7...",                                  │
│        "size": 3800                                                  │
│      }                                                               │
│    },                                                                │
│    "latest": "2.0.0"                                                 │
│  }                                                                   │
│                                                                      │
│  That's ALL the registry knows. Just enough to:                      │
│    1. Search (name, description, category)                           │
│    2. Download (url)                                                 │
│    3. Verify (sha256, size)                                          │
│                                                                      │
│  Everything else lives in the module itself (__hlvm_meta).           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Module Metadata (what the compiled main.js contains)

```
┌─── main.js — __hlvm_meta export ────────────────────────────────────┐
│                                                                      │
│  export const __hlvm_meta = {                                        │
│    name:        "Competitor Monitor",                                │
│    description: "Track competitor pricing changes",                  │
│    version:     "2.0.0",                                             │
│    author:      "jane",                                              │
│    icon:        "chart.bar.xaxis",          // SF Symbol             │
│    effect:      "agent",                    // auto-detected         │
│    permissions: ["network", "filesystem"],  // auto-detected         │
│    category:    "monitoring",                                        │
│    params:      [                                                    │
│      { name: "url", type: "string", label: "Competitor URL" },      │
│      { name: "frequency", type: "select",                           │
│        options: ["hourly", "daily", "weekly"] }                      │
│    ]                                                                 │
│  };                                                                  │
│                                                                      │
│  // Plus the actual code:                                            │
│  export async function monitor(url, frequency) { ... }               │
│                                                                      │
│  KEY INSIGHT:                                                        │
│  - The module is self-describing. No separate manifest.              │
│  - GUI reads __hlvm_meta directly from the ESM module.               │
│  - Effect and permissions are compiler-inferred, not declared.       │
│  - The compiled JS IS the module. Self-contained.                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### What goes where

```
Information              Registry JSON         __hlvm_meta
──────────────          ──────────────        ─────────────
Name                    yes (searchable)      yes (display)
Description             yes (searchable)      yes (display)
Author                  yes (searchable)      yes (display)
Category                yes (searchable)      yes (display)
Version                 yes (per-version)     yes (current)
Download URL            yes                   no
sha256 hash             yes                   no
File size               yes                   no
Icon                    no                    yes
Effect                  no                    yes (auto-detected)
Permissions             no                    yes (auto-detected)
Params                  no                    yes
Code                    NEVER                 yes (it IS the code)

Rule: Registry = discovery + verification.
      Module = runtime metadata + execution.
```

---

## Publishing Flow

### CLI Command: `hlvm deploy`

One command does everything:

```
$ hlvm deploy

  Step 1/4: Compiling
  index.hql → dist/main.js ...................... done
  Effect detected: agent (uses agent() calls)
  Permissions detected: network, filesystem

  Step 2/4: Uploading code
  Creating GitHub release @jane/competitor-monitor@2.0.0 . done
  Uploaded: main.js (4.2 KB, code + metadata bundled)
  URL: github.com/jane/hlvm-modules/releases/tag/competitor-monitor-2.0.0

  Step 3/4: Updating registry
  Forking hlvm/registry ......................... done
  Adding entry: modules/j/jane/competitor-monitor.json .. done
  Creating PR #1847 ............................. done

  Step 4/4: Confirm
  ✓ Code uploaded to your GitHub.
  ✓ Registry PR created: github.com/hlvm/registry/pull/1847
  ✓ Once merged, searchable via `hlvm search monitor`.
```

### What `hlvm deploy` Does Internally

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  $ hlvm deploy                                                       │
│                                                                      │
│  Step 1: Compile HQL → ESM                                           │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ index.hql → dist/main.js  (7-stage compiler pipeline)       │    │
│  │ Effect checker auto-detects effect + permissions             │    │
│  │ __hlvm_meta export embedded in the compiled output           │    │
│  │ No separate hlvm.json. The JS IS the module.                 │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                       │                                              │
│  Step 2: Upload code to AUTHOR'S OWN hosting                         │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                                                               │    │
│  │  Option A: GitHub Releases (default)                         │    │
│  │    gh release create competitor-monitor-2.0.0 dist/main.js   │    │
│  │    URL: github.com/jane/hlvm-modules/releases/...            │    │
│  │                                                               │    │
│  │  Option B: JSR (Deno registry)                               │    │
│  │    deno publish → jsr:@jane/competitor-monitor               │    │
│  │                                                               │    │
│  │  Option C: npm                                               │    │
│  │    npm publish → @jane/competitor-monitor                    │    │
│  │                                                               │    │
│  │  Option D: Any HTTP URL                                      │    │
│  │    Upload to any CDN / server / S3 bucket                    │    │
│  │                                                               │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                       │                                              │
│  Step 3: Register in hlvm/registry (Git PR, like Homebrew)           │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ a. Fork hlvm/registry (if not already forked)                │    │
│  │ b. Add/update modules/j/jane/competitor-monitor.json         │    │
│  │ c. Open PR to hlvm/registry                                  │    │
│  │ d. CI validates:                                              │    │
│  │    - URL is reachable                                         │    │
│  │    - sha256 matches downloaded content                        │    │
│  │    - __hlvm_meta is valid (has required fields)               │    │
│  │    - @hlvm/* namespace not squatted                           │    │
│  │ e. Maintainers merge (or auto-merge if CI passes)            │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                       │                                              │
│  Step 4: Confirm                                                     │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ PR URL returned to author                                     │    │
│  │ Module searchable once PR is merged                           │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌── WHY THIS MODEL ────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  - Zero server to maintain (Git is the database)             │   │
│  │  - Code stays with the author (their GitHub, their control)  │   │
│  │  - Registry is MIT licensed, community-maintained            │   │
│  │  - Anyone can audit the registry (it's a public Git repo)    │   │
│  │  - Works offline (clone the registry, have all metadata)     │   │
│  │  - PRs for quality control (CI validates, humans approve)    │   │
│  │  - Exactly like Homebrew: github.com/Homebrew/homebrew-core  │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Authentication for Publishing

Authors authenticate via GitHub (the registry IS on GitHub):

```
$ hlvm login
  Opening browser for GitHub OAuth...
  ✓ Logged in as @jane (via GitHub)

$ hlvm deploy
  Publishing as @jane...
  ✓ Code uploaded to github.com/jane/hlvm-modules
  ✓ Registry PR created: github.com/hlvm/registry/pull/1847
```

Authentication is GitHub OAuth. No separate auth system needed.
The PR is submitted from the author's GitHub account. Their identity
IS their GitHub identity. Simple.

---

## Discovery Flow

### GUI: Module Store View

The HLVM macOS app includes a Store view for browsing the registry. The GUI
reads the registry index (a local clone or cached JSON) and displays modules:

```
┌──────────────────────────────────────────────────────────────────┐
│                     HLVM Module Store                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ Q  Search modules...                                 │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                  │
│  FEATURED                                          See All >     │
│  ┌──────────────────────────────────────────────────────┐        │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐    │        │
│  │  │ Sentmnt│  │ Report │  │CodeRevw│  │Resrchr │    │        │
│  │  │ @hlvm  │  │ @hlvm  │  │ @alice │  │ @bob   │    │        │
│  │  │ AI     │  │ Agent  │  │ AI     │  │ Agent  │    │        │
│  │  └────────┘  └────────┘  └────────┘  └────────┘    │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                  │
│  RECENTLY ADDED                                    See All >     │
│  ┌──────────────────────────────────────────────────────┐        │
│  │  1. Competitor Monitor    @jane        Agent         │        │
│  │  2. Stock Analyzer        @carol       AI            │        │
│  │  3. Email Triager         @dave        Agent         │        │
│  │  4. PDF Summarizer        @hlvm        AI            │        │
│  │  5. Test Generator        @eve         Agent         │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                  │
│  CATEGORIES                                                      │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│  │ Data │ │Write │ │ Code │ │Resrch│ │Auto  │ │Mail  │        │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘        │
│                                                                  │
│  BY EFFECT LEVEL                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│  │ Pure     │  │ AI       │  │ Agent    │                       │
│  │ 142 mods │  │ 891 mods │  │ 367 mods │                       │
│  └──────────┘  └──────────┘  └──────────┘                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### GUI: Module Detail View

When the user clicks a module, the detail view displays metadata read from
`__hlvm_meta` in the compiled ESM (downloaded on demand or from a cached
registry summary):

```
┌──────────────────────────────────────────────────────────────────┐
│  < Back                                                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Competitor Monitor                                       v2.0.0 │
│  by @jane                                                        │
│                                                                  │
│  Track competitor pricing changes across multiple sites          │
│  and receive alerts when prices change. Configurable             │
│  check frequency and threshold alerts.                           │
│                                                                  │
│  ┌────────────────────────────────────────┐                      │
│  │  Effect:       Agent (full access)     │                      │
│  │  Permissions:  network, filesystem     │                      │
│  │  Category:     Monitoring              │                      │
│  │  Size:         4.2 KB                  │                      │
│  │  Source:       github.com/jane/...     │                      │
│  └────────────────────────────────────────┘                      │
│                                                                  │
│  Input Parameters:                                               │
│  ┌────────────────────────────────────────┐                      │
│  │  url        string   "Competitor URL"  │                      │
│  │  frequency  select   hourly/daily/wkly │                      │
│  └────────────────────────────────────────┘                      │
│                                                                  │
│              ┌──────────────────┐                                 │
│              │     Install      │                                 │
│              └──────────────────┘                                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### GUI: Search Results (Spotlight Integration)

The HLVM Spotlight also searches the registry:

```
┌──────────────────────────────────────────────┐
│ Q  sentiment                                  │
├──────────────────────────────────────────────┤
│                                              │
│  INSTALLED (Launchpad)                       │
│  Sentiment Analyzer             @hlvm    AI  │
│                                        Run > │
│                                              │
│  IN REGISTRY                                 │
│  Sentiment Dashboard            @alice  Agt  │
│                                    Install > │
│                                              │
│  Emotion Classifier             @bob     AI  │
│                                    Install > │
│                                              │
│  Sentiment Trends               @carol  Agt  │
│                                    Install > │
│                                              │
└──────────────────────────────────────────────┘
```

Installed modules show "Run" (executes immediately from Launchpad).
Registry modules show "Install" (downloads then adds to Launchpad).

### CLI: Search and Install

```bash
$ hlvm search sentiment

  @hlvm/sentiment-analyzer    AI       Official
    Classify text sentiment with confidence score

  @alice/sentiment-dashboard  Agent    Community
    Full sentiment analysis with visualizations

  @bob/emotion-classifier     AI       Community
    Classify emotions (joy, anger, sadness, etc.)

$ hlvm install @hlvm/sentiment-analyzer

  Resolving @hlvm/sentiment-analyzer@latest .... 1.2.0
  Downloading from github.com/hlvm/... ......... done (2.1 KB)
  Verifying sha256 ............................. match
  Reading __hlvm_meta .......................... done
  Installed to ~/.hlvm/modules/@hlvm/sentiment-analyzer/1.2.0/

  ✓ Installed. Added to Launchpad.
```

### Install Destination: Launchpad and Hotbar

```
Install → Launchpad (ALL installed modules appear here)
                │
                └── Pin / assign shortcut → Hotbar (frequently used subset)

┌─── Launchpad ─────────────────────────────────────────────────┐
│                                                                │
│  ALL installed modules. The full inventory.                    │
│  Grid view in the macOS GUI. Every install lands here.         │
│                                                                │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│  │Sentimnt│ │ Commit │ │CompMntr│ │CSVFmt  │ │EmailTrg│     │
│  │ @hlvm  │ │@seoksn │ │ @jane  │ │ @bob   │ │ @dave  │     │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘     │
│  ┌────────┐ ┌────────┐ ┌────────┐                            │
│  │PDFSumm │ │TestGen │ │StockAn │                            │
│  │ @hlvm  │ │ @eve   │ │@carol  │                            │
│  └────────┘ └────────┘ └────────┘                            │
│                                                                │
└────────────────────────────────────────────────────────────────┘

┌─── Hotbar ────────────────────────────────────────────────────┐
│                                                                │
│  SUBSET of Launchpad. Only what the user has pinned or         │
│  assigned a keyboard shortcut to. Quick access bar.            │
│                                                                │
│  ┌────────┐ ┌────────┐ ┌────────┐                            │
│  │Sentimnt│ │ Commit │ │CompMntr│                            │
│  │ Cmd+1  │ │ Cmd+2  │ │ Cmd+3  │                            │
│  └────────┘ └────────┘ └────────┘                            │
│                                                                │
│  Launchpad is EVERYTHING installed.                            │
│  Hotbar is YOUR FAVORITES.                                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Trust and Safety Model

### Trust Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│                       Trust Model                                │
│                                                                  │
│  ┌──────────────┬──────────────┬────────────────────────────┐   │
│  │ Tier         │ Badge        │ How to achieve             │   │
│  ├──────────────┼──────────────┼────────────────────────────┤   │
│  │ Official     │ Official     │ Published by @hlvm team    │   │
│  │              │ (blue)       │ Part of the platform       │   │
│  ├──────────────┼──────────────┼────────────────────────────┤   │
│  │ Verified     │ Verified     │ PR reviewed by maintainers │   │
│  │              │ (green)      │ Code audited for safety    │   │
│  ├──────────────┼──────────────┼────────────────────────────┤   │
│  │ Community    │ Community    │ PR merged with CI-only     │   │
│  │              │ (gray)       │ Auto-merged, not audited   │   │
│  └──────────────┴──────────────┴────────────────────────────┘   │
│                                                                  │
│  How this works with the Git registry:                           │
│                                                                  │
│  - Official: PR from @hlvm org member → auto-merged              │
│  - Verified: PR reviewed by a maintainer → manual merge          │
│  - Community: PR passes CI checks → auto-merged                  │
│                                                                  │
│  Trust tier is determined by the PR merge process, not a         │
│  server-side flag. The Git history IS the audit trail.           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Effect-Driven Permission Model

When a user installs a module, the GUI shows what it can do based on the
effect classification read from `__hlvm_meta`:

```
Installing "Competitor Monitor" by @jane (Verified)

  This module requires:

  Agent Effect — Full system access

    - Network access     Make HTTP requests and AI calls
    - File system        Read and write files on your computer
    - Shell commands     Execute terminal commands

  This is an Agent module. It can take autonomous actions
  on your computer including reading/writing files and
  running commands.

           ┌──────────┐  ┌──────────┐
           │  Cancel   │  │ Install  │
           └──────────┘  └──────────┘
```

For AI modules (no file/shell access):

```
Installing "Sentiment Analyzer" by @hlvm (Official)

  This module requires:

  AI Effect — Network only

    - Network access     Make AI API calls

  This module only makes AI calls. It cannot access
  your files or run commands.

           ┌──────────┐  ┌──────────┐
           │  Cancel   │  │ Install  │
           └──────────┘  └──────────┘
```

For Pure modules (no permissions):

```
Installing "CSV Formatter" by @bob (Community)

  This module requires:

  Pure — No permissions needed

  This module runs entirely locally with no network
  access, file access, or system access.

                       ┌──────────┐
                       │ Install  │
                       └──────────┘
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

### CI Validation on PR

The registry's CI pipeline runs automated checks on every PR:

```
1. URL reachable:    Download the main.js from the declared URL
2. sha256 match:     Hash the downloaded file, compare to declared hash
3. Size match:       File size matches declared size
4. __hlvm_meta:      Import module, check __hlvm_meta has required fields
5. Name check:       @hlvm/* namespace reserved for official modules
6. Size limit:       Max 1MB per module (ESM code should be small)
7. Malware scan:     Static analysis for known dangerous patterns
8. Duplicate check:  Detect near-identical republishes under new names
```

Reports and moderation use GitHub Issues on hlvm/registry. Users file an issue
to report a module. Maintainers can remove the JSON entry via PR.

---

## Registry Infrastructure

### The Entire "Backend"

```
┌──────────────────────────────────────────────────────────────────┐
│                    Registry Infrastructure                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  github.com/hlvm/registry                                  │  │
│  │                                                            │  │
│  │  A public Git repository containing:                       │  │
│  │  - modules/     JSON metadata files (one per module)       │  │
│  │  - .github/     CI workflows for PR validation             │  │
│  │  - README.md    Contributor guidelines                     │  │
│  │                                                            │  │
│  │  That's the entire infrastructure.                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Server cost:      $0/month (GitHub hosts the repo for free)    │
│  Database:         Git (the repo IS the database)               │
│  CDN:              GitHub raw content / API (free)              │
│  Auth:             GitHub OAuth (free)                           │
│  CI/CD:            GitHub Actions (free for public repos)       │
│  Monitoring:       GitHub (uptime, audit log — free)            │
│  Backup:           Git (every clone is a full backup)           │
│                                                                  │
│  10,000 modules × ~500 bytes per JSON = ~5MB total repo size   │
│  Cost at scale: still $0/month                                  │
│                                                                  │
│  Compare:                                                        │
│  ┌────────────────────┬──────────────────────────────────────┐  │
│  │  Central server    │  Git registry                        │  │
│  ├────────────────────┼──────────────────────────────────────┤  │
│  │  API server        │  None (Git + GitHub API)             │  │
│  │  Database          │  None (JSON files in Git)            │  │
│  │  File storage      │  None (authors host their own)       │  │
│  │  CDN               │  None (authors host their own)       │  │
│  │  Auth system       │  GitHub OAuth (free)                 │  │
│  │  Cost              │  $50-500+/month                      │  │
│  │  Maintenance       │  DevOps team                         │  │
│  │  Single point of   │  None (Git is distributed)           │  │
│  │    failure         │                                      │  │
│  └────────────────────┴──────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Open Source

The registry is MIT licensed. Anyone can:

- Fork the entire registry (corporate/private use)
- Run a private registry (same format, different repo)
- Mirror the public registry
- Contribute modules (PRs)
- Audit every module entry (it's a public Git repo with full history)

The official instance is `github.com/hlvm/registry`, community-maintained,
exactly like `github.com/Homebrew/homebrew-core`.

---

## Ranking and Discovery

### Search

The `hlvm search` command and the GUI Store view search the registry JSON:

```
$ hlvm search sentiment

How it works:
  1. Read local clone of hlvm/registry (or fetch index from GitHub API)
  2. Match query against name + description + category fields
  3. Rank by relevance (name match > description match > category match)
  4. Display results
```

The GUI can maintain a cached search index (rebuilt on `hlvm update` or
periodically). A flat JSON index file in the registry root enables fast
client-side search without scanning individual module files:

```
hlvm/registry/
├── modules/          (individual module JSON files)
└── index.json        (aggregated searchable index — auto-generated by CI)
```

### Featured and Categories

Featured modules are curated via a `featured.json` file in the registry:

```
hlvm/registry/
├── featured.json     (maintainer-curated list of highlighted modules)
├── categories.json   (canonical category definitions)
└── modules/          (module entries)
```

These are edited via PR, same as everything else. No admin panel needed.

### Categories

```
Data Analysis      Monitoring       Writing
Code Tools         Research         Communication
Automation         Finance          Education
DevOps             Design           Productivity
```

---

## CLI and Registry Reference

### CLI Commands

```
hlvm search <query>                   Search the registry
hlvm install <module>[@version]       Download + verify + add to Launchpad
hlvm install --local <path>           Compile local HQL + add to Launchpad
hlvm uninstall <module>               Remove from Launchpad + delete files
hlvm update                           Check registry for newer versions
hlvm deploy                           Compile + upload + PR to registry
hlvm login                            GitHub OAuth login
hlvm info <module>                    Show module details from registry
```

### Registry JSON Format

Each module has one JSON file in `modules/<first-letter>/<author>/<name>.json`:

```json
{
  "name": "Competitor Monitor",
  "author": "jane",
  "description": "Track competitor pricing changes across multiple sites",
  "category": "monitoring",
  "versions": {
    "2.0.0": {
      "url": "https://github.com/jane/hlvm-modules/releases/download/competitor-monitor-2.0.0/main.js",
      "sha256": "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890",
      "size": 4200,
      "published": "2026-03-28"
    },
    "1.3.1": {
      "url": "https://github.com/jane/hlvm-modules/releases/download/competitor-monitor-1.3.1/main.js",
      "sha256": "b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890ab",
      "size": 3800,
      "published": "2026-03-15"
    }
  },
  "latest": "2.0.0"
}
```

### Local Module Directory

```
~/.hlvm/modules/
├── @hlvm/
│   └── sentiment-analyzer/
│       ├── 1.2.0/
│       │   └── main.js           (compiled ESM — code + __hlvm_meta)
│       └── current → 1.2.0/      (symlink to active version)
├── @jane/
│   └── competitor-monitor/
│       ├── 2.0.0/
│       │   └── main.js
│       └── current → 2.0.0/
├── @local/
│   └── my-commit/
│       └── main.js               (local-only, never published)
└── index.json                    (local module index for fast lookup)
```

### Namespace Convention

```
@hlvm/*        Official modules (reserved, only @hlvm org members can publish)
@<username>/*  User modules (GitHub username)
@local/*       Local-only modules (never published, hlvm install --local)
```

---

## Migration and Compatibility

### ESM Compatibility

Modules are standard ESM JavaScript. They can be:

- Imported by any JavaScript project (`import { analyze } from "...";`)
- Run by any JS runtime (Node.js, Deno, Bun, browsers)
- Published ALSO to npm/JSR if authors want broader reach
- Used outside of HLVM entirely

The registry is an HLVM-optimized discovery layer, but the modules themselves
are not locked to HLVM. This is a feature: it lowers the barrier for authors
(their module works everywhere) and prevents vendor lock-in for users.

---

## Growth Stages

```
Stage 1 — Bootstrap (Month 1-3):
  ├── hlvm/registry repo created on GitHub
  ├── CI workflow for PR validation (url, sha256, __hlvm_meta checks)
  ├── hlvm deploy + hlvm install commands working
  ├── Store view in macOS GUI reading from registry
  ├── 20-30 official @hlvm/* modules
  ├── Invite-only publishing for early authors (curated PRs)
  └── Goal: prove the loop works (author → deploy → PR → merge → search → install)

Stage 2 — Open (Month 3-6):
  ├── Open publishing (anyone can submit PRs)
  ├── Auto-merge for PRs that pass CI (Community tier)
  ├── Manual review path for Verified badge
  ├── featured.json and categories.json curated by maintainers
  ├── index.json auto-generated for client-side search
  └── Goal: 100+ community modules, early flywheel

Stage 3 — Growth (Month 6-12):
  ├── Maintainer team expands (community contributors)
  ├── Bot-assisted PR review (auto-approve safe modules)
  ├── Module composition tools (potions calling potions)
  ├── AI-authored module publishing workflows
  ├── Private registry support (same format, private repo)
  └── Goal: 1,000+ modules, self-sustaining ecosystem

Stage 4 — Scale (Month 12+):
  ├── Enterprise private registries (GitHub Enterprise repos)
  ├── Module analytics (download counts via GitHub API)
  ├── Cross-registry federation (multiple registries)
  ├── Registry mirrors for reliability
  └── Goal: HLVM is the default way to use AI on macOS
```
