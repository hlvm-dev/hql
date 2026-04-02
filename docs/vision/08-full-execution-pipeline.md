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
