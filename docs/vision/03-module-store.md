# 03 — The Module Store

**The central registry: design, requirements, trust model, and flywheel.**

---

## Why a Central Store Is Critical (Not Optional)

Without a central store:

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

With a central store:

```
┌──────────────────────────────────────────┐
│  User writes HQL module                  │
│  $ hlvm deploy                           │
│  Module appears in Store for ALL users   │
│                                          │
│  Other users search → install → use →    │
│  star → more users find it → author      │
│  writes more → ecosystem grows →         │
│  more users join →                       │
│                                          │
│  NETWORK EFFECT. Flywheel.               │
│  This is how npm, App Store, Docker Hub  │
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
Chrome          →   Chrome Web Store      Just another browser
Homebrew        →   homebrew-core         Just another pkg mgr

HLVM            →   Module Store          Just another AI tool
                    (BUILD THIS)
```

**NPM made Node.js dominant. Not the other way around.** The registry IS the
moat. It IS the product.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                     HLVM Module Store                            │
│                    (central service)                             │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                    Module Registry                        │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │  ESM Code   │  │  Manifest   │  │   Social    │      │  │
│  │  │  Storage    │  │  Database   │  │   Signals   │      │  │
│  │  │             │  │             │  │             │      │  │
│  │  │ .js files   │  │ hlvm.json   │  │ stars       │      │  │
│  │  │ served via  │  │ records     │  │ installs    │      │  │
│  │  │ CDN         │  │ searchable  │  │ trending    │      │  │
│  │  │             │  │ indexed     │  │ ratings     │      │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │  │
│  │                                                           │  │
│  │  API:                                                     │  │
│  │    POST /publish          Upload module + manifest        │  │
│  │    GET  /search?q=...     Search modules by keyword       │  │
│  │    GET  /trending         Top modules by time window      │  │
│  │    GET  /featured         Curated/editor's picks          │  │
│  │    GET  /categories       Browse by category              │  │
│  │    GET  /module/:id       Full manifest + download URL    │  │
│  │    GET  /download/:id     Serve ESM code                  │  │
│  │    POST /star/:id         Star a module                   │  │
│  │    GET  /author/:name     Author's modules + stats        │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
         ▲                                    ▲
         │                                    │
    Read (search,                        Write (publish,
    browse, install,                     star, rate)
    download)                                 │
         │                                    │
         ▼                                    ▼
┌──────────────────┐              ┌──────────────────┐
│  HLVM macOS App  │              │  hlvm CLI        │
│  (Store view)    │              │  (hlvm deploy)   │
│                  │              │  (hlvm publish)  │
│  Spotlight       │              │  (hlvm install)  │
│  Browse          │              │                  │
│  Install         │              │  Authors use     │
│  Star            │              │  this to publish │
│                  │              │                  │
│  Users use this  │              │                  │
│  to discover     │              │                  │
└──────────────────┘              └──────────────────┘
```

---

## What the Store Stores

Per module, the Store holds:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Module Record                                              │
│                                                             │
│  Metadata (from hlvm.json):                                 │
│  ├── name:        "Competitor Monitor"                      │
│  ├── description: "Track competitor pricing changes"        │
│  ├── version:     "2.0.0"                                   │
│  ├── author:      "jane"                                    │
│  ├── icon:        "chart.bar.xaxis"   (SF Symbol)           │
│  ├── effect:      "agent"                                   │
│  ├── permissions: ["network", "filesystem"]                 │
│  ├── category:    "monitoring"                              │
│  ├── params:      [{name: "url", type: "string", ...}]     │
│  ├── source:      "hql"                                     │
│  └── readme:      "Full markdown description..."            │
│                                                             │
│  Code (the actual ESM):                                     │
│  ├── main.js      (compiled ESM, the executable module)     │
│  ├── main.js.map  (source map, optional)                    │
│  └── deps/        (vendored dependencies, if any)           │
│                                                             │
│  Social Signals:                                            │
│  ├── stars:       890                                       │
│  ├── installs:    3,200                                     │
│  ├── weeklyTrend: "+12%"                                    │
│  ├── rating:      4.7 / 5.0                                │
│  ├── reviews:     [{author: "bob", text: "...", score: 5}]  │
│  └── verified:    true                                      │
│                                                             │
│  Versions:                                                  │
│  ├── 2.0.0 (current)                                        │
│  ├── 1.3.1                                                  │
│  └── 1.0.0                                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Publishing Flow

### CLI Command: `hlvm deploy`

One command does everything:

```
$ hlvm deploy

  Compiling main.hql → dist/main.js ............... done
  Generating hlvm.json manifest .................... done
  Detecting effect level ........................... agent
  Detecting permissions ............................ network, filesystem

  Publishing to HLVM Module Store:
    Package: @jane/competitor-monitor@2.0.0
    Size:    4.2 KB (ESM) + 312 B (manifest)
    Effect:  agent (red badge)

  Uploading code .................................. done
  Registering manifest ............................ done

  ✓ Published successfully.
  ✓ Searchable in HLVM Module Store now.
  ✓ URL: https://store.hlvm.dev/@jane/competitor-monitor
```

### What `hlvm deploy` Does Internally

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  $ hlvm deploy                                               │
│                                                              │
│  Step 1: Compile HQL → ESM                                   │
│  ┌──────────────────────────────────────┐                    │
│  │ main.hql → dist/main.js             │                    │
│  │ (using HQL compiler, same as today) │                    │
│  └──────────────────────────────────────┘                    │
│                       │                                      │
│  Step 2: Generate / validate hlvm.json                       │
│  ┌──────────────────────────────────────┐                    │
│  │ Read existing hlvm.json or generate  │                    │
│  │ Infer effect level from code         │                    │
│  │ Infer permissions from tool usage    │                    │
│  │ Validate all required fields         │                    │
│  └──────────────────────────────────────┘                    │
│                       │                                      │
│  Step 3: Bundle                                              │
│  ┌──────────────────────────────────────┐                    │
│  │ Collect: main.js + hlvm.json         │                    │
│  │ Vendor dependencies if needed        │                    │
│  │ Create tarball                       │                    │
│  └──────────────────────────────────────┘                    │
│                       │                                      │
│  Step 4: Upload to Store                                     │
│  ┌──────────────────────────────────────┐                    │
│  │ POST store.hlvm.dev/publish          │                    │
│  │ Body: tarball + auth token           │                    │
│  │ Store validates, indexes, serves     │                    │
│  └──────────────────────────────────────┘                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Authentication for Publishing

Authors authenticate with the Store to publish:

```
$ hlvm login
  Opening browser for authentication...
  ✓ Logged in as @jane

$ hlvm deploy
  Publishing as @jane...
  ✓ Published @jane/competitor-monitor@2.0.0
```

Authentication options:
- GitHub OAuth (primary — most developers have GitHub)
- Email/password (fallback)
- API token for CI/CD publishing

---

## Discovery Flow

### GUI: Module Store View

The HLVM macOS app includes a Module Store view, visually similar to the
Mac App Store:

```
┌──────────────────────────────────────────────────────────────┐
│                     HLVM Module Store                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Q  Search modules...                                 │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  FEATURED                                          See All ▸ │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐    │    │
│  │  │  😊    │  │  📝    │  │  💻    │  │  🔍    │    │    │
│  │  │Sentimnt│  │ Report │  │CodeRevw│  │Resrchr │    │    │
│  │  │ ★ 2.4k │  │ ★ 1.8k │  │ ★ 1.2k │  │ ★ 980  │    │    │
│  │  │ ● AI   │  │ ● Agent│  │ ● AI   │  │ ● Agent│    │    │
│  │  └────────┘  └────────┘  └────────┘  └────────┘    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  TRENDING THIS WEEK                                See All ▸ │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  1. 📊  Competitor Monitor    ★ 890   ↑ 23%  ● Agt  │    │
│  │  2. 📈  Stock Analyzer        ★ 650   ↑ 18%  ● AI   │    │
│  │  3. 📧  Email Triager         ★ 540   ↑ 15%  ● Agt  │    │
│  │  4. 📄  PDF Summarizer        ★ 420   ↑ 12%  ● AI   │    │
│  │  5. 🧪  Test Generator        ★ 380   ↑ 11%  ● Agt  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  CATEGORIES                                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│  │ Data │ │Write │ │ Code │ │Resrch│ │Auto  │ │Mail  │    │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘    │
│                                                              │
│  BY EFFECT LEVEL                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ ● Pure   │  │ ● AI     │  │ ● Agent  │                   │
│  │ 142 mods │  │ 891 mods │  │ 367 mods │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### GUI: Module Detail View

```
┌──────────────────────────────────────────────────────────────┐
│  ◀ Back                                                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  📊  Competitor Monitor                              v2.0.0  │
│  by @jane · Verified ✓                                       │
│                                                              │
│  ★★★★★ 4.7  ·  890 stars  ·  3.2k installs                  │
│                                                              │
│  Track competitor pricing changes across multiple sites      │
│  and receive alerts when prices change. Configurable         │
│  check frequency and threshold alerts.                       │
│                                                              │
│  ┌────────────────────────────────────────┐                  │
│  │  Effect:       ● Agent (full access)   │                  │
│  │  Permissions:  network, filesystem     │                  │
│  │  Category:     Monitoring              │                  │
│  │  Source:       HQL                     │                  │
│  │  Size:         4.2 KB                  │                  │
│  │  Last updated: 2026-03-28              │                  │
│  └────────────────────────────────────────┘                  │
│                                                              │
│  Input Parameters:                                           │
│  ┌────────────────────────────────────────┐                  │
│  │  url        string   "Competitor URL"  │                  │
│  │  frequency  select   hourly/daily/wkly │                  │
│  └────────────────────────────────────────┘                  │
│                                                              │
│              ┌──────────────────┐                             │
│              │     Install      │                             │
│              └──────────────────┘                             │
│                                                              │
│  README                                                      │
│  ────────────────────────────────────────                    │
│  ## Usage                                                    │
│  This module monitors competitor pricing by...               │
│                                                              │
│  REVIEWS                                                     │
│  ────────────────────────────────────────                    │
│  ★★★★★  @bob   "Exactly what I needed"         2026-03-25   │
│  ★★★★☆  @alice "Great but slow on large sites" 2026-03-20   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### GUI: Search Results (Spotlight Integration)

The HLVM Spotlight also searches the Module Store:

```
┌──────────────────────────────────────────────┐
│ Q  sentiment                                  │
├──────────────────────────────────────────────┤
│                                              │
│  INSTALLED                                   │
│  😊  Sentiment Analyzer          ★ 2.4k  ✓  │
│      @hlvm · AI · Verified              Run ▸│
│                                              │
│  IN STORE                                    │
│  📊  Sentiment Dashboard         ★ 650      │
│      @alice · Agent · Community    Install ▸ │
│                                              │
│  🎭  Emotion Classifier          ★ 340      │
│      @bob · AI · Community         Install ▸ │
│                                              │
│  📈  Sentiment Trends            ★ 120      │
│      @carol · Agent · Community    Install ▸ │
│                                              │
└──────────────────────────────────────────────┘
```

Installed modules show "Run" (executes immediately). Store modules show
"Install" (downloads then adds to local).

### CLI: Search and Install

```bash
$ hlvm search sentiment

  @hlvm/sentiment-analyzer  ★ 2.4k  ↓ 12k  AI      Verified
    Classify text sentiment with confidence score

  @alice/sentiment-dashboard  ★ 650  ↓ 3.2k  Agent  Community
    Full sentiment analysis with visualizations

  @bob/emotion-classifier  ★ 340  ↓ 1.2k  AI       Community
    Classify emotions (joy, anger, sadness, etc.)

$ hlvm install @hlvm/sentiment-analyzer

  Downloading @hlvm/sentiment-analyzer@1.2.0 ... done
  Effect: AI (network access required)
  Size: 2.1 KB

  ✓ Installed. Added to Hotbar.
```

---

## Trust and Safety Model

### Trust Tiers

```
┌─────────────────────────────────────────────────────────────┐
│                       Trust Model                            │
│                                                              │
│  ┌──────────────┬──────────────┬──────────────────────────┐ │
│  │ Tier         │ Badge        │ How to achieve           │ │
│  ├──────────────┼──────────────┼──────────────────────────┤ │
│  │ Official     │ ✓ Official   │ Published by @hlvm team  │ │
│  │              │ (blue)       │ Part of the platform     │ │
│  ├──────────────┼──────────────┼──────────────────────────┤ │
│  │ Verified     │ ✓ Verified   │ Reviewed by maintainers  │ │
│  │              │ (green)      │ Code audited for safety  │ │
│  ├──────────────┼──────────────┼──────────────────────────┤ │
│  │ Community    │ Community    │ Published by anyone      │ │
│  │              │ (gray)       │ Not reviewed             │ │
│  └──────────────┴──────────────┴──────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Effect-Driven Permission Model

When a user installs a module, the GUI shows what it can do based on the
effect classification:

```
Installing "Competitor Monitor" by @jane (Verified ✓)

  This module requires:

  ● Agent Effect — Full system access

    ☐ Network access     Make HTTP requests and AI calls
    ☐ File system        Read and write files on your computer
    ☐ Shell commands     Execute terminal commands

  This is an Agent module. It can take autonomous actions
  on your computer including reading/writing files and
  running commands.

           ┌──────────┐  ┌──────────┐
           │  Cancel   │  │ Install  │
           └──────────┘  └──────────┘
```

For AI modules (no file/shell access):

```
Installing "Sentiment Analyzer" by @hlvm (Official ✓)

  This module requires:

  ● AI Effect — Network only

    ☐ Network access     Make AI API calls

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

  ● Pure — No permissions needed

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

This is sandboxing via the effect system. The module's declared permissions
become its runtime sandbox.

---

## Store Infrastructure

### Technology Stack

```
┌──────────────────────────────────────────────────────────────┐
│                    Store Infrastructure                       │
│                                                              │
│  ┌────────────────┐                                          │
│  │  API Server    │  Deno Deploy (serverless, free tier)     │
│  │  (Deno/Hono)   │  or any hosting (Fly.io, Railway, etc.) │
│  └───────┬────────┘                                          │
│          │                                                   │
│  ┌───────┴────────┐                                          │
│  │  Database      │  PostgreSQL (Neon free tier)             │
│  │                │  or SQLite (for small scale)             │
│  │  Tables:       │                                          │
│  │  - modules     │  Manifest metadata + social signals      │
│  │  - versions    │  Version history                         │
│  │  - authors     │  Author profiles + auth                  │
│  │  - stars       │  User → module star records              │
│  │  - reviews     │  User reviews + ratings                  │
│  │  - installs    │  Anonymous install counters              │
│  └───────┬────────┘                                          │
│          │                                                   │
│  ┌───────┴────────┐                                          │
│  │  File Storage  │  S3 / R2 (Cloudflare) / GCS             │
│  │                │  Stores actual ESM files + tarballs      │
│  │                │  Served via CDN                          │
│  └───────┬────────┘                                          │
│          │                                                   │
│  ┌───────┴────────┐                                          │
│  │  CDN           │  Cloudflare (free tier)                  │
│  │                │  Serves module downloads globally        │
│  └────────────────┘                                          │
│                                                              │
│  Total cost (early stage):                                   │
│    API: Free (Deno Deploy free tier)                         │
│    DB:  Free (Neon free tier, 512MB)                         │
│    Storage: ~$0.015/GB/month (R2)                            │
│    CDN: Free (Cloudflare free tier)                          │
│                                                              │
│    10,000 modules × ~5KB average = 50MB                      │
│    Cost: effectively $0/month until massive scale            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Open Source

The Module Store server is itself open source (MIT). Anyone can:

- Self-host their own registry (for corporate/private use)
- Fork and modify the store code
- Run a mirror
- Contribute improvements

The official instance at `store.hlvm.dev` is community-maintained, like how
`crates.io` is maintained by the Rust community and `jsr.io` by the Deno team.

---

## Ranking and Discovery Algorithms

### Trending

```
trending_score = installs_last_7_days / max(installs_last_7_days)

Displayed as:   ↑ 23%  (week-over-week install growth)
```

### Featured

Curated by maintainers. Criteria:
- High quality code
- Good documentation (README)
- Useful to broad audience
- Verified or Official tier

### Search Ranking

```
search_score = (name_match × 10)
             + (description_match × 5)
             + (category_match × 3)
             + log(stars + 1)
             + log(installs + 1)
             + (verified ? 2 : 0)
             + (official ? 5 : 0)
```

### Categories

```
Data Analysis      Monitoring       Writing
Code Tools         Research         Communication
Automation         Finance          Education
DevOps             Design           Productivity
```

---

## Moderation and Abuse Prevention

### Automated Checks on Publish

```
1. Size limit:     Max 1MB per module (ESM code should be small)
2. Manifest valid: All required fields present and valid
3. Name check:     No impersonation (@hlvm/* reserved for official)
4. Malware scan:   Static analysis for known dangerous patterns
5. Duplicate check: Detect near-identical republishes
```

### Reporting

Users can report modules:
- Malware / malicious behavior
- Impersonation
- Broken / doesn't work
- Inappropriate content

Reports trigger maintainer review. Modules can be delisted.

### Rate Limiting

- Publish: 10 modules/day per author
- Star: 100 stars/day per user
- Install tracking: Anonymous, no PII stored

---

## API Reference

### POST /publish

Upload a new module or version.

```
Headers:
  Authorization: Bearer <token>
  Content-Type: multipart/form-data

Body:
  tarball: <module.tar.gz>     (ESM code + hlvm.json)

Response: 201 Created
  { "name": "@jane/monitor", "version": "2.0.0", "url": "..." }
```

### GET /search

Search modules by keyword.

```
GET /search?q=sentiment&category=data&effect=ai&sort=stars&limit=20

Response: 200 OK
  {
    "results": [
      {
        "name": "@hlvm/sentiment",
        "description": "Classify text sentiment",
        "version": "1.2.0",
        "author": "hlvm",
        "icon": "face.smiling",
        "effect": "ai",
        "stars": 2400,
        "installs": 12000,
        "verified": true,
        "trust": "official"
      },
      ...
    ],
    "total": 42,
    "page": 1
  }
```

### GET /trending

Top modules by recent install growth.

```
GET /trending?period=week&limit=100

Response: 200 OK
  { "results": [...], "period": "2026-03-23..2026-03-30" }
```

### GET /module/:scope/:name

Full module details.

```
GET /module/@jane/competitor-monitor

Response: 200 OK
  {
    "name": "@jane/competitor-monitor",
    "description": "...",
    "versions": ["2.0.0", "1.3.1", "1.0.0"],
    "latest": "2.0.0",
    "manifest": { ... },
    "readme": "# Competitor Monitor\n...",
    "stats": { "stars": 890, "installs": 3200 },
    "reviews": [...],
    "trust": "verified"
  }
```

### GET /download/:scope/:name/:version

Download module tarball.

```
GET /download/@jane/competitor-monitor/2.0.0

Response: 200 OK
  Content-Type: application/gzip
  Body: <module.tar.gz>
```

### POST /star/:scope/:name

Star a module.

```
Headers:
  Authorization: Bearer <token>

Response: 200 OK
  { "stars": 891 }
```

---

## Migration and Compatibility

### ESM Compatibility

Modules are standard ESM JavaScript. They can be:

- Imported by any JavaScript project (`import { analyze } from "...";`)
- Run by any JS runtime (Node.js, Deno, Bun, browsers)
- Published ALSO to npm/JSR if authors want broader reach
- Used outside of HLVM entirely

The Store is an HLVM-optimized registry, but the modules themselves are not
locked to HLVM. This is a feature: it lowers the barrier for authors (their
module works everywhere) and prevents vendor lock-in for users.

### Namespace Convention

```
@hlvm/*        Official modules (reserved)
@<username>/*  User modules (GitHub username)
```

---

## Growth Stages

```
Stage 1 — Bootstrap (Month 1-3):
  ├── Store API server deployed
  ├── hlvm deploy + hlvm install commands working
  ├── Store view in macOS GUI
  ├── 20-30 official @hlvm/* modules
  ├── Invite-only publishing for early authors
  └── Goal: prove the loop works (author → deploy → discover → install → use)

Stage 2 — Open (Month 3-6):
  ├── Open publishing for anyone
  ├── Star/rating system
  ├── Trending/featured algorithms
  ├── Categories and search
  ├── Verified badge program
  └── Goal: 100+ community modules, early flywheel

Stage 3 — Growth (Month 6-12):
  ├── Review system
  ├── Author profiles and reputation
  ├── Collections (curated lists)
  ├── AI-authored module publishing
  ├── Module composition tools
  └── Goal: 1,000+ modules, self-sustaining ecosystem

Stage 4 — Scale (Month 12+):
  ├── API marketplace (paid modules?)
  ├── Enterprise/private registries
  ├── Module analytics for authors
  ├── Automated testing / CI for modules
  └── Goal: HLVM is the default way to use AI on macOS
```
