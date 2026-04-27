# HLVM Skills System

**Status**: Phase 1/2/3/4/4.1/4.2 complete as of 2026-04-26; Phase 5 explicit
drafting foundation complete as of 2026-04-27. **Owner**: skills foundation.
**Current shipped scope**: `agentskills.io` core, global user skills, bundled
foundational skills, small CLI surface, REPL/ask activation, CC-style transcript
row, local skill import, Git/GitHub skill install, explicit template/AI skill
drafting, AI skill improvement, PR-ready publish packaging, no project scope,
package-manager lifecycle, official static-index search/install by slug, public
`hlvm-dev/skills` catalog, no silent auto-generation. **Next phase**: optional
passive workflow suggestion only after explicit authoring proves useful.

This doc is a complete cold-start briefing. If you are a new AI or engineer with
zero prior context, read top-to-bottom once and you will know exactly what to
build, why, and in what order.

---

## 1. The one-paragraph summary

HLVM supports **Skills** — the open `agentskills.io` standard for agent
procedural knowledge. A skill is a folder containing a `SKILL.md` file with YAML
frontmatter (name + description) and a markdown body (the recipe), plus optional
`scripts/`, `references/`, and `assets/` subfolders. HLVM scans global user
skills from `~/.hlvm/skills` and bundled skills from
`~/.hlvm/.runtime/bundled-skills`, indexes frontmatter, and injects a compact
`<available_skills>` block into the system prompt. When a task matches a skill,
the model reads the body through normal read tools; when the user explicitly
invokes `/<skill-name>`, HLVM injects the skill body into a normal agent turn.
Users can bring in ecosystem skills with `hlvm skill import <path>`,
`hlvm skill install <git-source>`, or `hlvm skill install <slug>` after finding
them with `hlvm skill search <query>`, then maintain them with
`hlvm skill update`, `hlvm skill remove`, and `hlvm skill check`. There is no
special executor, project-local scope, dependency installer, install hook, or
hidden backdoor path. Repository discovery uses an HLVM-owned GitHub static
index, not a custom server or broad GitHub-search scraping.

---

## 2. What `agentskills.io` is

- An open specification originated by Anthropic for Claude Code, then extracted
  to its own site so other tools could interop.
- Spec site: `https://agentskills.io` (adopters list, specification page).
- Reference implementation: `github.com/anthropics/skills`.
- The spec itself is tiny: directory layout, SKILL.md frontmatter schema,
  discovery contract. Fits on one page.
- It is to skills what MCP is to tools: a portable format that means "write
  once, run anywhere."

### The file contract

```
<root>/<skill-name>/
  ├── SKILL.md         (required)
  ├── scripts/         (optional: executables the body references)
  ├── references/      (optional: deep docs the model can read on demand)
  └── assets/          (optional: templates, sample data)
```

### SKILL.md frontmatter (the minimum)

```markdown
---
name: pdf-tool
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
---

# How to handle PDFs

## Step 1: Identify the operation

- Extract text → use scripts/extract.py
- Fill form → use scripts/fill.py
- Merge files → use scripts/merge.py

## Common edge cases

- Scanned PDFs need OCR first (see references/ocr.md)
- Encrypted PDFs require the password arg
```

Required frontmatter keys: `name` (kebab-case, 1–64 chars), `description`
(one-line, used for matching).

Official optional fields are `license`, `compatibility`, `metadata`, and
experimental `allowed-tools`. Product dialect fields such as CC hooks, model
routing, aliases, and command hints are intentionally out of core scope.

### Mental model

```
Tool    = a verb (code that does X)        — e.g. read_file, shell_exec
MCP     = remote tool server protocol       — modelcontextprotocol.io
Skill   = a RECIPE for using verbs well    — agentskills.io
Memory  = facts about the user over time    — HLVM has this (V3)
Prompt  = one-shot system message
```

Tools and skills are complementary, not competing. A skill often teaches the
model **how to use tools well for task X**.

---

## 3. How competitors implement skills

All three use the same agentskills.io foundation. They differ only in the
authoring surface and distribution platform around it.

| Feature                                            | CC      | OpenClaw        | Hermes      |
| -------------------------------------------------- | ------- | --------------- | ----------- |
| agentskills.io SKILL.md format                     | yes     | yes             | yes         |
| Frontmatter parser, on-demand body load            | yes     | yes             | yes         |
| `<available_skills>` XML in prompt                 | yes     | yes             | yes         |
| Bundled skills in binary                           | yes     | yes             | yes         |
| Precedence tiers                                   | 3       | 6               | 3           |
| Dynamic discovery (walk up from edited file)       | **yes** | no              | no          |
| Conditional skills via `paths:` frontmatter        | **yes** | no              | no          |
| CLI: `skills new` scaffolding                      | no      | **yes**         | yes         |
| CLI: `skills list` / `info`                        | no      | **yes**         | yes         |
| Slash command `/skill-name`                        | yes     | yes             | yes         |
| Gating via `metadata.*.requires.{bins,env,config}` | no      | **yes**         | partial     |
| Per-agent skill allowlists                         | no      | **yes**         | no          |
| Env injection scoped to agent run                  | no      | **yes**         | no          |
| Public registry                                    | no      | **ClawHub**     | GitHub only |
| `skills install <slug>`                            | no      | **yes**         | no          |
| Dangerous-code scanner                             | no      | **yes**         | no          |
| GUI skill manager                                  | no      | **yes** (macOS) | no          |
| Hot-reload watcher                                 | memoize | yes             | yes         |
| Agent auto-generates SKILL.md from trajectories    | no      | no              | **yes**     |
| "Self-improving" marketing frame                   | no      | no              | **yes**     |

### Reading this table

- **CC** is the lean end. One loader file, ~1000 lines, memoized. Smart
  additions: dynamic discovery walks up from files being edited to find nested
  `.claude/skills/` dirs; conditional skills activate only when file paths match
  the `paths:` frontmatter. No registry because CC is a code assistant, not a
  platform.

- **OpenClaw** is the heavy end. ~60 files across parsing, gating, install,
  registry (ClawHub), security scanning, macOS GUI. Solves the distribution
  problem: skills declare their dependencies (`requires.bins`, `requires.env`),
  and the UI can auto-install them. Per-agent allowlists because OpenClaw
  supports multi-agent workspaces.

- **Hermes** is the marketing-forward middle. Simpler than OpenClaw, no
  registry. Unique feature: after a successful multi-step task, the agent is
  prompted to distill the trajectory into a SKILL.md. This is what gets marketed
  as "self-improving AI." The mechanism is real. The framing is overclaimed —
  reviewers report the auto-generated skills are often trivial or duplicative,
  and the separate Atropos RL work is not in the live hot path.

### One-line takeaways

```
CC        "a developer tool, keep it lean"
OpenClaw  "a full personal-AI platform"
Hermes    "a self-improving agent brand"
```

---

## 4. Why HLVM must implement this

1. **It is the norm, not a copy.** ~35 tools have adopted. Not supporting it
   reads as a gap, the way not supporting Markdown would.
2. **The shipped foundation is now real.** HLVM has a core loader, prompt
   injection, explicit activation, bundled skills, CLI inspection/authoring, and
   user-facing E2E coverage.
3. **The core spec is tiny.** A loader, a frontmatter parser, and one
   prompt-injection hook. Everything else (registry, install, UI) is optional
   scaffolding.
4. **Execution piggybacks on existing tools.** Skill bodies reference
   `scripts/foo.py` — the agent calls it via the existing `shell_exec` tool.
   SKILL.md body is read via the existing Read tool. No new execution path.
5. **It is the highest-ROI single feature HLVM can ship.** ~1 week of work →
   unlocks compatibility with every SKILL.md ever written for any adopter.

---

## 5. Current decision — what HLVM should copy

This was the main unresolved question after the first version of this doc. After
reading the local CC and OpenClaw implementations under `~/dev`, the decision
is:

```text
Compatibility contract:  agentskills.io
Implementation references: CC and OpenClaw
Actual v1 shape:         HLVM-native, global-only, spec-first
Not for v1: Hermes auto-generation / self-improving flow
```

This does **not** mean "copy CC exactly" or "build OpenClaw parity." It means
HLVM implements the portable common core natively. CC informs the lean
prompt/runtime interaction and transcript UX; OpenClaw informs loader hardening,
CLI ergonomics, and later distribution. The compatibility target is the
`agentskills.io` spec, not either product dialect.

### Why this is the current best recommendation

- **`agentskills.io`** is the non-negotiable compatibility target. That is the
  format HLVM should accept.
- **Claude Code** is useful because it treats skills as a **lightweight
  prompt/runtime feature**, not a separate product platform.
- **OpenClaw** is useful mainly as a donor for a few practical implementation
  pieces: path containment, prompt XML formatting, prompt-budget behavior, CLI
  command sanitization, and multi-source precedence tests.
- **Hermes** is explicitly a later idea only. If HLVM ever adds "suggest this as
  a skill?", that should be user-reviewed and should come after the basic
  platform works.

### Local code review notes (2026-04-24)

Read these files before changing the plan again:

- `~/dev/ClaudeCode-main/skills/loadSkillsDir.ts`
  - One main loader/command path.
  - Loads directory-format skills: `<root>/<skill-name>/SKILL.md`.
  - Indexes frontmatter, keeps full body for invocation, estimates prompt cost
    from compact metadata.
  - Discovers multiple root classes in CC, dedupes by realpath, memoizes
    results.
  - HLVM must copy only the global user-root shape. Project/additional roots do
    not fit HLVM's global assistant model.
  - Has advanced CC-only polish: legacy `/commands` compatibility, dynamic
    nested discovery, `paths:` conditional skills, prompt shell execution,
    model/effort/hooks frontmatter.
  - HLVM should copy the core shape, not the full command/frontmatter surface.
- `~/dev/openclaw-main/src/agents/skills/local-loader.ts`
  - Good reference for safe local loading: realpath root containment, immediate
    subfolder scanning, `SKILL.md` only, size cap, skip invalid frontmatter.
  - HLVM should reimplement the safety ideas through `getPlatform()` and
    `src/common/paths.ts`, not import Node `fs/path` directly.
- `~/dev/openclaw-main/src/agents/skills/skill-contract.ts`
  - Good reference for `<available_skills>` XML and the instruction to resolve
    relative paths against the skill directory.
  - HLVM should keep the XML compact and include `name`, `description`, and
    `location`.
- `~/dev/openclaw-main/src/agents/skills/workspace.ts`
  - Good reference for precedence, prompt limits, compact fallback, path
    compaction, and suspicious-large-root caps.
  - HLVM should start smaller: user > bundled, scan once per session, no
    watcher.
- `~/dev/openclaw-main/src/agents/skills/command-specs.ts`
  - Good reference for slash command name sanitization and collision handling.
  - HLVM v1 slash commands should still become normal user turns, not OpenClaw
    `command-dispatch: tool`.
- `~/dev/openclaw-main/src/agents/skills/config.ts`, `frontmatter.ts`,
  `env-overrides.ts`, `plugin-skills.ts`, `refresh.ts`
  - These are OpenClaw platform features: dependency gating, env/config
    injection, plugin merging, hot reload.
  - Do not bring them into HLVM v1.

### Common skills support vs OpenClaw platform features

The key mistake to avoid is treating "skills support" and "full OpenClaw parity"
as the same thing.

#### Common, portable skills features HLVM should aim for in v1

- Standard `agentskills.io` folder and `SKILL.md` support
- Parse frontmatter (`name`, `description`)
- Scan global user roots
- Simple precedence and duplicate resolution
- Compact `<available_skills>` prompt injection
- On-demand skill body load
- Slash activation (`/skill-name ...`)
- Small local CLI (`list`, `new`, `info`)
- Local folder/pack import into `~/.hlvm/skills`
- Git/GitHub install into `~/.hlvm/skills`
- Prompt-budget awareness
- Basic path containment / traversal hardening
- Later official GitHub-backed skill repository search/install-by-slug

#### OpenClaw-specific product features HLVM should NOT treat as v1 requirements

- ClawHub registry (`search`, slug install, `update`)
- `metadata.openclaw.*` installer and gating model
- `skills.entries.*` config/env/apiKey injection
- Gateway / operator RPC methods for skills
- Watcher / hot-reload
- Sandbox skill mirroring
- Plugin skill merging into the same resolver
- Full dangerous-code scanning and dependency install orchestration
- GUI skills manager

### Plain-language restatement

For HLVM v1, "skills support" should mean:

```text
read standard skills
+ expose them to the model
+ let the user invoke them locally
+ let the user import/install plain skill folders safely
```

It should **not** mean:

```text
build a custom registry server
+ build dependency installer orchestration
+ build a secrets/config management layer for skills
+ build a gateway-admin product surface
```

---

## 6. Three implementation tiers considered

| Tier                                     | What it includes                                        | LOC  | Days | Fit             |
| ---------------------------------------- | ------------------------------------------------------- | ---- | ---- | --------------- |
| **A** — CC-style core                    | Load skills users drop in folders. No CLI, no scaffold. | ~300 | 3    | too bare alone  |
| **B** — CC core + OpenClaw-lite local UX | A + `hlvm skill new/list/info` + `/skill-name` REPL.    | ~700 | 7    | **recommended** |
| **C** — Hermes-style                     | B + agent writes own SKILL.md after successful tasks.   | ~900 | 10   | defer           |

### Why B is the recommended v1

- A alone leaves users hand-mkdir'ing skills. Feels unfinished.
- C's auto-generation is additive. You can add it in ~3 days on top of B if
  demand appears. The cost of waiting is zero.
- C's quality is uncertain. Hermes reviewers report the auto-generated skills
  are noisy. Shipping untested auto-generation risks skill-spam and creates a
  curation problem (who prunes bad generated skills?).
- B gives HLVM the useful local consumption layer without dragging in OpenClaw's
  registry/config/gateway platform.

---

## 7. V1 scope — recommended (tier B)

### In v1

| Feature                            | Notes                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| SKILL.md parsing                   | Standard agentskills.io frontmatter. Plain YAML.                                        |
| Skill roots                        | `~/.hlvm/skills/` + bundled (shipped in binary). Runtime directories are targets only.  |
| Precedence                         | user > bundled. Keep it simple.                                                         |
| On-demand body load                | Index frontmatter at startup. Body read via existing Read tool on match.                |
| `<available_skills>` XML injection | New hook in orchestrator Stage 3, alongside `maybeInjectMemoryRecall`.                  |
| Scripts / references / assets      | No new code needed. Skill body references paths; existing shell/read tools handle them. |
| CLI: `hlvm skill list`             | Table: name, description, source, status.                                               |
| CLI: `hlvm skill new <name>`       | Scaffold an authored global `SKILL.md`.                                                 |
| CLI: `hlvm skill draft <name>`     | Draft an authored global `SKILL.md` from an explicit workflow goal.                     |
| CLI: `hlvm skill info <name>`      | Show frontmatter + first N lines of body.                                               |
| CLI: `hlvm skill import <path>`    | Copy a local skill folder or pack into `~/.hlvm/skills`.                                |
| CLI: `hlvm skill install <source>` | Clone a Git/GitHub source, then reuse the same import pipeline.                         |
| CLI: `hlvm skill edit <name>`      | Not shipped; optional later if user demand appears.                                     |
| REPL slash commands                | `/skill-name <args>` invokes skill body as a user turn.                                 |
| Session snapshot                   | Scan-once at session start, reuse per turn.                                             |

### Foundational bundled skills

The bundled set should be small and foundational. It should teach workflows
every coding agent needs, not ship product-specific automations.

Recommended first bundled set:

| Skill          | User-facing purpose                                                               |
| -------------- | --------------------------------------------------------------------------------- |
| `verify`       | Prove a change works with narrow tests, source-level checks, and SSOT validation. |
| `debug`        | Investigate a failure from symptom to root cause before changing code.            |
| `code-review`  | Review code for bugs, regressions, missing tests, and risky behavior.             |
| `plan`         | Break larger implementation work into phases without creating process ceremony.   |
| `write-docs`   | Update docs, READMEs, changelogs, and user-facing explanations coherently.        |
| `skill-author` | Create or improve `agentskills.io` `SKILL.md` folders.                            |

Do **not** start v1 with product/domain skills such as `kakao-send`,
`chrome-extension-debug`, `computer-use-session`, or `release-checklist`. Those
are useful later as optional packs, but they should not define the core system.

Bundled skills should not block the first merge if packaging turns out to be
non-trivial. The loader/CLI/interoperability path is the core deliverable; the
foundational pack can land immediately after.

### Deferred to v2+ (only if demand appears)

| Feature                                                        | Why deferred                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Dynamic discovery (walk up from edited file)                   | CC-specific polish. Real value unclear for HLVM's use cases.                                   |
| Conditional skills via `paths:` frontmatter                    | Same.                                                                                          |
| Hot-reload watcher                                             | Restart is fine for v1.                                                                        |
| `metadata.*.requires.{bins,env,config}` gating                 | OpenClaw-specific platform behavior. Useful later, but not required for common skills support. |
| Per-agent skill allowlists                                     | HLVM's agent-team module already has scoping. Revisit when it conflicts.                       |
| External taps/user-added indexes                               | Official static index comes first. Add taps only if users need multiple catalogs.              |
| Full dangerous-code scanner                                    | Phase 4 has symlink/size/staging hardening only. Add deeper script scanning next if needed.    |
| Trajectory → SKILL auto-generation (Hermes)                    | Quality uncertain. Add only after observing how users actually author skills.                  |
| macOS GUI skill manager                                        | OpenClaw-style polish. Defer until there's a clear user ask.                                   |
| `metadata.openclaw.*`, `skills.entries.*`, gateway skills APIs | Explicitly OpenClaw-specific. Do not introduce as v1 requirements for HLVM.                    |

---

## 8. Architecture — where it plugs in

```
src/hlvm/agent/skills/          NEW — only new subsystem in v1
  types.ts        SkillSource, SkillEntry, SkillSnapshot, SkillDuplicate
  store.ts        scan roots, parse frontmatter, build snapshot, read SKILL.md body
  prompt.ts       serialize snapshot into compact <available_skills> XML
  install.ts      authored drafts plus local/Git/GitHub import pipeline;
                  validates then writes to user root
  authoring.ts    AI authoring prompts and generated SKILL.md normalization
  repository.ts   static index search/install and publish packaging

src/hlvm/cli/commands/
  skill.ts        NEW — list / new / draft / improve / publish / install UX

src/hlvm/cli/repl/commands.ts
  (existing slash-command surface gains dynamic /skill-name routing)

src/hlvm/agent/orchestrator.ts or its Pre-LLM stage:
  Add one call:  maybeInjectSkills(state, userPrompt)
  Placement: alongside maybeInjectMemoryRecall.

tests/unit/agent/               NEW — skills-*.test.ts for loader, frontmatter, precedence
tests/unit/cli/                 NEW — skill-command.test.ts and related CLI coverage
```

### Concrete B1 implementation contract

This is the first build. If the implementation does exactly this and no more, it
is a good first merge.

#### `src/common/paths.ts`

Add canonical path helpers only:

```typescript
export const HLVM_SKILLS_SEGMENT = "skills";
export function getUserSkillsDir(): string;
```

Rules:

- Use `getHlvmDir()` for the user root.
- Use `getPlatform().path` for filesystem paths.
- Do not create directories just by resolving runtime target paths. Creation
  belongs to `hlvm skill new`.

#### `src/hlvm/agent/skills/types.ts`

Keep the data model boring and inspectable:

```typescript
export type SkillSource = "user" | "bundled";

export type SkillEntry = {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: SkillSource;
};

export type SkillDuplicate = {
  name: string;
  winner: SkillEntry;
  shadowed: SkillEntry[];
};

export type SkillSnapshot = {
  skills: SkillEntry[];
  duplicates: SkillDuplicate[];
};
```

Do not add OpenClaw dependency requirements, per-agent filters, command
dispatch, registry IDs, or config/env fields in v1. Plain `metadata` is allowed
only as the official agentskills.io key-value extension point.

#### `src/hlvm/agent/skills/store.ts`

Public API:

```typescript
export async function loadSkillSnapshot(options?: {
  includeBundled?: boolean;
  runtimeTarget?: string;
}): Promise<SkillSnapshot>;

export async function readSkillBody(entry: SkillEntry): Promise<string>;

export function findSkillByName(
  snapshot: SkillSnapshot,
  name: string,
): SkillEntry | undefined;
```

Rules:

- Scan only immediate children of each root: `<root>/<skill-name>/SKILL.md`.
- Parse only frontmatter for the prompt index.
- Require `name` and `description` strings.
- Validate names as kebab-case, 1-64 chars.
- Resolve duplicates by precedence: `user > bundled`.
- Preserve duplicate/shadow metadata for CLI display or debug logs.
- Use platform filesystem/path APIs only.
- Do not execute scripts, inspect `scripts/`, or read `references/` during
  scanning.
- Do not add watchers or recurring refresh loops.

#### `src/hlvm/agent/skills/prompt.ts`

Public API:

```typescript
export function formatSkillsForPrompt(snapshot: SkillSnapshot): string;
```

Prompt shape:

```xml
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory.

<available_skills>
  <skill>
    <name>debug</name>
    <description>Investigate failures from symptoms to root cause.</description>
    <location>/absolute/path/to/SKILL.md</location>
  </skill>
</available_skills>
```

Rules:

- Escape XML content.
- Return `""` when no skills exist.
- Keep full skill bodies out of the system prompt.
- If prompt-budget limits are added later, use a compact fallback before
  dropping skills. The current foundation keeps full skill bodies out of the
  system prompt, so catalog pressure is limited to frontmatter/index metadata.

#### `src/hlvm/agent/orchestrator.ts`

Add one hook beside memory recall:

```typescript
maybeInjectSkills(state, userRequest, config);
```

Rules:

- Inject once per agent loop/session snapshot, not every iteration.
- Do not scan roots inline in the main loop if a session-level snapshot is
  available.
- Fail soft: skill loading should not block the user's task unless the user
  explicitly invoked a missing/broken skill.

#### `src/hlvm/cli/commands/skill.ts`

Required B1 commands:

```bash
hlvm skill list
hlvm skill new <name>
hlvm skill search [query] [--limit <n>] [--json]
hlvm skill info <name>
hlvm skill info <name> --remote
hlvm skill import <path> [--force]
hlvm skill install <slug-or-git-source> [--version <version>] [--force]
hlvm skill update <name|--all>
hlvm skill remove <name>
hlvm skill check [--json]
```

Rules:

- `list` shows name, source, path, and description.
- `new` creates `<target>/<name>/SKILL.md` with valid frontmatter and a minimal
  body.
- `info` shows frontmatter and a short body preview.
- `info --remote` shows static-index metadata before install.
- `search` reads the official static index and shows slug, version, trust, and
  description.
- `import` accepts either one skill folder with `SKILL.md` or a pack directory
  whose immediate children contain `SKILL.md`.
- `install` accepts repository slugs or Git/GitHub sources. Slugs resolve
  through `repository.ts`; all final writes still call the same import pipeline.
- `update` reuses the original local/Git source provenance and then calls the
  same validated import/install pipeline with `--force` semantics.
- `remove` deletes only a named global user skill.
- `check` validates installed user skills and bundled skills, reporting invalid
  frontmatter, symlinks, oversize, missing license, missing/stale origin, and
  script warnings.
- Default `new` target is `~/.hlvm/skills`; no project/local target.
- `--force` replaces an existing user skill only after the source validates and
  stages successfully.
- No dependency checks, env injection, install hooks, external taps, broad
  GitHub-search primary path, or auto-generation in the shipped Phase 4.2 path.

### B1 acceptance criteria

- A user skill at `~/.hlvm/skills/debug/SKILL.md` appears in `hlvm skill list`.
- A runtime-target skill at `./.hlvm/skills/debug/SKILL.md` is ignored.
- The orchestrator injects a compact `<available_skills>` block containing only
  name, description, and location.
- The full `SKILL.md` body is not injected unless the model or slash command
  explicitly reads/invokes it.
- `hlvm skill new example-skill` creates a valid agentskills.io folder.
- `hlvm skill import ./skill-or-pack` installs into the global user root and
  does not read CWD-local skills as a runtime source.
- `hlvm skill install github:owner/repo/path` clones then reuses the import
  pipeline; there is no registry-specific install path.
- `deno task ssot:check` finishes with zero errors after the change.

### Integration points (what NOT to touch)

- **Memory V3** — skills are not memory. Do not extend `memory_write`. A skill
  is procedural knowledge the user or agent authored; memory is facts observed
  over time. Different subsystems.
- **MCP client** — skills are not MCP tools. Skills are markdown recipes; MCP is
  remote tool protocol. They sit at different layers.
- **Provider layer** — skills are prompt-side. Nothing in `providers/` needs to
  change.
- **Tools registry** — skills reuse existing tools. No new tool surface.

### Data flow per user prompt

```
startup (cached)
  scan ~/.hlvm/skills/*/SKILL.md
  scan bundled
  parse frontmatter only  →  skillIndex: [{name, description, filePath, source}, ...]

import/install (user-triggered)
  path/Git/GitHub source
    → stage in temp/sibling dir
    → validate SKILL.md with the same parser used by the store
    → reject symlinks and oversized files/trees
    → copy into ~/.hlvm/skills/<name>
    → write .hlvm/origin.json with source/ref/hash provenance
    → clear snapshot cache

update/remove/check (user-triggered)
  ~/.hlvm/skills/<name>
    → install.ts lifecycle functions only
    → update re-enters import/install pipeline
    → remove deletes only global user skill dir
    → check validates user + bundled entries without mutating files

each turn (Stage 3 Pre-LLM in orchestrator)
  maybeInjectSkills(state, userPrompt)
    serialize skillIndex as XML block into system message
    token cost: ~24 tokens × skill count

LLM reasons
  picks matching skill from list
  calls existing Read tool on the skill's filePath
  body now in context

LLM executes
  skill body references scripts/extract.py
  LLM invokes existing shell_exec tool
  result returned
```

---

## 9. Decisions and remaining choices

### Locked for v1

1. **Tier B is the target.** Build CC-style core plus small local CLI/REPL UX.
2. **Role model is settled.** HLVM follows CC for runtime shape and uses
   OpenClaw only for selected hardening/UX ideas.
3. **Slash semantics are simple.** `/skill-name <args>` becomes a normal agent
   turn with the skill recipe attached. No OpenClaw-style
   `command-dispatch: tool` in v1.
4. **Bundled content is foundational.** Start with general coding-agent building
   blocks such as `verify`, `debug`, `code-review`, `plan`, `write-docs`, and
   `skill-author`.
5. **Precedence is simple.** User overrides bundled. There are no CWD-local,
   project-local, or walk-up skill roots in v1. Duplicate names resolve by
   precedence.
6. **No platform expansion.** No custom registry server, dependency installer
   orchestration, secrets/config layer, GUI manager, watcher, plugin merge, or
   auto-generation in v1. Phase 4's local/Git/GitHub install is a file-copy
   distribution layer, not a dependency installer or registry platform.

### Still open while implementing

1. **`hlvm skill edit`.** Optional.
   `list/new/info/import/install/update/remove/check` are implemented.
2. **TUI v2 parity.** Ink REPL and `hlvm ask --verbose` skill activity display
   are implemented. TUI v2/full GUI parity can follow if that surface exposes
   skills directly.

---

## 10. Journey tracker

Use this as the single progress board. Update it whenever a phase lands.

Legend: `[ ]` not started, `[~]` in progress, `[x]` complete, `[?]` decision
point.

### Phase 0 — direction and references

- [x] Read SSOT contract and repo rules.
- [x] Read `docs/todo/skills-system.md`.
- [x] Verify HLVM integration points: `frontmatter.ts`, `paths.ts`, orchestrator
      memory hook, CLI registry, REPL command catalog, Ink `SKILL_MARKER`.
- [x] Read local CC implementation under `~/dev/ClaudeCode-main/skills/`.
- [x] Read local OpenClaw implementation under
      `~/dev/openclaw-main/src/agents/skills/`.
- [x] Decide role model: `agentskills.io` compatibility + CC runtime shape +
      OpenClaw-lite hardening/UX.

### Phase 1 — B1 core runtime and CLI

- [x] Add skills path helpers in `src/common/paths.ts`.
- [x] Add `src/hlvm/agent/skills/types.ts`.
- [x] Add `src/hlvm/agent/skills/store.ts` for frontmatter-only scanning,
      validation, source tagging, precedence, and duplicate handling.
- [x] Add `src/hlvm/agent/skills/prompt.ts` for compact `<available_skills>`
      XML.
- [x] Hook `maybeInjectSkills(...)` beside `maybeInjectMemoryRecall(...)`.
- [x] Add `src/hlvm/cli/commands/skill.ts`.
- [x] Register `hlvm skill list`.
- [x] Register `hlvm skill new <name>`.
- [x] Register `hlvm skill info <name>`.
- [x] Add narrow unit tests for parsing, scanning, precedence, and prompt
      serialization.
- [x] Run relevant narrow `deno test ...` targets.
- [x] Run `deno task ssot:check`.

### Phase 2 — B2 REPL invocation

- [x] Extend `getFullCommandCatalog()` with discovered skills.
- [x] Resolve unknown slash commands against the skill index before returning
      "unknown command."
- [x] Reuse the existing Ink `SKILL_MARKER` path to submit `/skill-name <args>`
      as an agent turn with recipe text attached.
- [x] Add completion/catalog tests for dynamic skill slash entries.
- [x] Add REPL command tests for skill invocation and missing-skill behavior.
- [x] Verify that a runtime-target skill from `.hlvm/skills/<name>/SKILL.md` is
      ignored.
- [x] Add CC-like skill activity rows in Ink and verbose ask output.
- [x] Run `deno task ssot:check`.

### Phase 3 — foundational bundled skills

- [x] Decide the bundled-skill asset path and binary packaging mechanism:
      embedded `SKILL.md` strings materialized to
      `~/.hlvm/.runtime/bundled-skills`.
- [x] Add `verify`.
- [x] Add `debug`.
- [x] Add `code-review`.
- [x] Add `refactor`.
- [x] Add `plan`.
- [x] Add `write-docs`.
- [x] Add `skill-author`.
- [x] Ensure user skills can override bundled skills by name.
- [x] Add tests proving bundled skills do not block user precedence.
- [x] Run `deno task ssot:check`.

### Phase 4 — ecosystem import/install

Start with local/GitHub import before any repository-backed search. The goal is
to let users bring existing agentskills.io folders into HLVM safely without
turning the core store into an installer.

- [x] Add `hlvm skill import <path>` for a local skill folder or skill pack.
- [x] Add validation for imported `SKILL.md`: required fields, size cap,
      duplicate names, reserved slash names, no symlink escape, no overwrite
      unless explicit. Source directory name may differ; destination is
      normalized to frontmatter `name`.
- [x] Preserve official optional fields: `license`, `compatibility`, `metadata`,
      and experimental `allowed-tools`.
- [x] Copy imported skills into `~/.hlvm/skills/<name>` only. No project-local
      target.
- [x] Add staging + `--force` semantics so replacement happens only after
      validation/copy succeeds.
- [x] Reject symlinks and oversized files/trees; skip source-control metadata
      (`.git`, `.clawhub`, `.hlvm`, `.DS_Store`) during copy.
- [x] Warn when importing `scripts/`; HLVM imports files only and does not run
      install hooks.
- [x] Add `hlvm skill install <git-url-or-github-spec>` and make it reuse the
      same validator/copy pipeline after `git clone`.
- [x] Keep repository search/install-by-slug out of the first Phase 4 cut.
- [x] Run real user E2E: install/import skill, `hlvm skill list/info`, explicit
      `/skill`, and automatic model-chosen read.

### Phase 4.1 — package-manager lifecycle

Phase 4.1 makes installed skills maintainable without introducing a central
catalog yet.

- [x] Add source/origin metadata for installed skills: source type, source URL,
      version/ref/hash, installed time, and whether local files were modified.
- [x] Add `hlvm skill remove <name>` for clean global-root deletion.
- [x] Add `hlvm skill update <name|--all>` for Git/GitHub-installed skills.
- [x] Add `hlvm skill check` / `audit` for local validation and warnings:
      missing `SKILL.md`, invalid frontmatter, symlinks, oversized trees,
      scripts, missing license, and stale/unknown origin.
- [x] Keep all lifecycle logic out of `store.ts` and `prompt.ts`.
- [x] Keep CLI as argument parsing/output only; skill writes and lifecycle logic
      are centralized in `src/hlvm/agent/skills/install.ts`.
- [x] Run real user E2E: Git install, origin info, check, update from new
      commit, dirty-file warning and restore, remove, compiled-binary smoke,
      explicit `/skill`, and automatic model-chosen read.

### Phase 4.2 — official GitHub skill repository/index

Decision: HLVM will use an HLVM-owned GitHub repository as the first central
skill catalog. This gives users simple search/install UX without custom server
cost, accounts, database, or a paid hosted app store.

Repository:

```text
github.com/hlvm-dev/skills
  index.json
  skills/
    debug/SKILL.md
    verify/SKILL.md
    code-review/SKILL.md
    refactor/SKILL.md
    plan/SKILL.md
    write-docs/SKILL.md
    skill-author/SKILL.md
```

Rules:

- [x] Use GitHub as static hosting and PR/CI review. No custom backend.
- [x] First user path is the official HLVM index, not user-added taps.
- [x] Do not use broad GitHub code search as the primary install path. It is
      noisy, rate-limited, and lacks stable metadata.
- [x] Preserve attribution/license and source provenance for every external
      skill.
- [x] Create/populate `github.com/hlvm-dev/skills`.
- [x] Define `index.json` schema: slug, name, description, install source,
      version map, license, tags, trust level, deprecation status.
- [x] Add CI in the skills repo to validate every indexed `SKILL.md`.
- [x] Add `hlvm skill search <query>` against the official static index.
- [x] Add `hlvm skill install <slug>` that resolves through the index and then
      reuses the existing validated `install.ts` pipeline.
- [x] Add `hlvm skill info <slug> --remote` or equivalent remote inspection
      before install.

Implemented Phase 4.2 CLI surface:

```text
hlvm skill search [query] [--limit <n>] [--json]
hlvm skill install <slug-or-git-source> [--version <version>] [--force]
hlvm skill info <slug> --remote
```

Implementation boundary:

- `src/hlvm/agent/skills/repository.ts` reads the static index, validates
  entries, searches metadata, resolves slugs/version entries, and delegates the
  final install to `install.ts`.
- `src/hlvm/agent/skills/install.ts` remains the only installed-skill write,
  staging, validation, update, remove, and check path.
- The default index URL is
  `https://raw.githubusercontent.com/hlvm-dev/skills/main/index.json`. Tests and
  local smoke runs can still use the internal `HLVM_TEST_SKILL_INDEX_URL` hook
  guarded by `HLVM_ALLOW_TEST_STATE_ROOT=1`.

### Phase 5 — assisted authoring

- [x] Add explicit `hlvm skill draft <name> <goal...>` as the safe foundation:
      no background detection, no silent writes, no model mutation loop.
- [x] Drafted and newly scaffolded skills are first-class authored user skills
      with `license: MIT` and `.hlvm/origin.json` metadata, so `skill check`
      does not misreport them as untracked installs.
- [x] Add preview support with `hlvm skill draft <name> <goal...> --print`.
- [x] Add protected replacement with `--force`; default behavior refuses to
      overwrite existing user skills.
- [x] Add `hlvm skill draft <name> <goal...> --ai` for model-generated
      `SKILL.md` content. The model output is normalized and validated through
      the same `SKILL.md` parser before saving.
- [x] Add `hlvm skill improve <name> <instruction...>` for user-reviewed AI
      replacement drafts. Default is preview-only; `--save` is required to
      mutate the existing skill.
- [x] Add `hlvm skill publish <name> --repo <path>` to package a user skill into
      a PR-ready `hlvm-dev/skills`-style repository (`skills/<name>/SKILL.md` +
      `index.json` entry).
- [?] External taps/user-added indexes after the official index proves useful.
- [?] Dynamic nested discovery from touched file paths, CC-style.
- [?] Conditional skills via `paths:` frontmatter, CC-style.
- [?] Dependency gating via `requires.{bins,env,config}`, OpenClaw-style.
- [?] Per-agent skill allowlists.
- [?] Hermes-style "suggest saving this workflow as a skill" with explicit user
  review.
- [ ] Optional later: passive workflow suggestion. Do not add this until
      explicit authoring has enough real examples to avoid noisy suggestions.

---

## 11. References

- `agentskills.io` — spec and adopter list.
- `github.com/anthropics/skills` — Anthropic reference skills.
- `~/dev/ClaudeCode-main/skills/loadSkillsDir.ts` — CC's loader (local copy for
  reading).
- `~/dev/openclaw-main/src/agents/skills/` — OpenClaw's skill subsystem (local
  copy).
- `~/dev/openclaw-main/docs/tools/skills.md` — OpenClaw skills doc (thorough
  reference).
- `docs/agent-loop/` — HLVM's existing agent architecture; the place skills plug
  in.
- `AGENTS.md` — HLVM project guidelines. Especially "Simplicity first" and
  "SSOT."

---

## 12. Decisions already locked in

- agentskills.io SKILL.md format is non-negotiable. HLVM adopts the standard
  as-is. No HLVM-specific frontmatter extensions in v1.
- Repository-backed search/install-by-slug is implemented through the official
  static index resolver. Installed-skill writes still go through `install.ts`.
- The repository direction is now decided: the first central skill catalog is an
  HLVM-owned GitHub static repository (`github.com/hlvm-dev/skills`), with
  create/update/delete through GitHub PRs and CI. No custom server, database,
  account system, or paid app-store backend for the first cut.
- Broad GitHub code search is not the primary install/search path. It can be an
  optional later discovery helper, but not the main package-manager source.
- No silent auto-generation in v1. The shipped Phase 5/8 foundation is explicit
  user-invoked authoring and publishing only: `draft`, `improve`, and `publish`.
- Skills are not memory, not tools, not MCP. New subsystem, narrow scope.
- `src/hlvm/agent/skills/` is the only new directory. Single hook point in the
  orchestrator. Reuse existing Read + shell_exec for execution.
- The role-model choice is locked for v1: `agentskills.io` is the compatibility
  target; CC and OpenClaw are references only, not dialects to copy wholesale.
- HLVM v1 is **not** "full OpenClaw parity". Registry/search/update, dependency
  installers, gateway-admin, and config-heavy pieces are out of scope unless a
  later product decision explicitly brings them in.

## 13. Assumptions the next AI should verify

- That `src/hlvm/agent/orchestrator.ts` still exposes a Pre-LLM stage hook like
  `maybeInjectMemoryRecall`. If this has moved or been renamed, skills injection
  goes in its new location.
- That the REPL slash-command surface is still centered in
  `src/hlvm/cli/repl/commands.ts`. If this has moved again, skills routing
  should follow the new command entry point.
- That `~/dev/ClaudeCode-main` and `~/dev/openclaw-main` still contain the
  clones referenced above. If not, re-fetch from their respective sources.
- That the HLVM CLI command registry still uses the same registration pattern as
  `src/hlvm/cli/commands/serve.ts` and peers. Model `skill.ts` after an existing
  command.

---

## 14. Repo reality check and working execution plan (2026-04-24)

This section updates the original brief against the current HLVM tree so the
next person can build from repo truth, not just product intent.

### What still holds

- `src/common/frontmatter.ts` already provides the YAML frontmatter parsing
  needed for `SKILL.md`.
- `src/hlvm/agent/orchestrator.ts` still has the exact kind of prompt-injection
  seam this feature needs: `maybeInjectMemoryRecall(...)` plus a call site in
  the main loop.
- `src/common/paths.ts` models global assistant directories (`~/.hlvm/agents`,
  `~/.hlvm/skills`, `~/.hlvm/worktrees`). Skills should use those helpers and
  must not mirror runtime-target `.hlvm` directories.
- `src/hlvm/cli/cli.ts` still uses a simple command registry, so adding
  `hlvm skill ...` is straightforward.
- `src/hlvm/cli/repl-ink/components/App.tsx` still contains a `SKILL_MARKER`
  re-submit path. That means slash-skill execution can piggyback on an existing
  UI affordance instead of inventing a new one.

### What is stale in the original brief

- "HLVM has zero skill concept" is stale. The Phase 1 subsystem exists under
  `src/hlvm/agent/skills/`.
- The current slash-command path is not `src/hlvm/cli/repl/handlers/`; the live
  command surface is `src/hlvm/cli/repl/commands.ts`.
- `getFullCommandCatalog()` appends discovered skills as `/<skill-name>`
  commands.
- The proposed test layout should follow existing repo structure:
  `tests/unit/agent/...` and `tests/unit/cli/...`, not brand-new top-level
  `tests/unit/skills/` and `tests/smoke/skills/` buckets.
- Bundled skills are embedded as TypeScript string constants and materialized to
  `~/.hlvm/.runtime/bundled-skills` so compiled binaries remain self-contained
  and the agent can still read concrete `SKILL.md` files.

### Working decisions now

- Build **tier B** as the stable base: `B1 core`, `B2 ergonomics`, and the Phase
  3 foundational bundled pack are implemented.
- Keep the open `agentskills.io` `SKILL.md` contract unchanged in v1. No
  HLVM-specific or CC-specific frontmatter keys.
- Use CC/OpenClaw as implementation references only. The v1 compatibility target
  is the agentskills.io spec, not either product dialect.
- Slash commands should use the simple v1 behavior: `/skill-name <args>` becomes
  a normal user turn with the skill recipe injected, not a special tool-dispatch
  path.
- Precedence should stay simple: `user > bundled` if bundled skills exist.
  Duplicate names resolve by precedence, not by showing both.
- The public `github.com/hlvm-dev/skills` repository exists, is populated with
  the first seven official skills, and CI validation is green.
- No Hermes-style trajectory-to-skill auto-generation in v1.
- Bundled skills are foundational and intentionally small: `verify`, `debug`,
  `code-review`, `refactor`, `plan`, `write-docs`, `skill-author`.
- OpenClaw-only platform pieces (`ClawHub`, `metadata.openclaw.*`,
  `skills.entries.*`, gateway skills RPC, watcher, sandbox mirroring) are
  **not** required for HLVM v1.

### Still not fully decided

- Whether `hlvm skill edit` is worth adding soon or should wait for user demand.
- Whether TUI v2/full GUI should expose skills directly beyond the current Ink
  REPL and `hlvm ask --verbose` display.

### Recommended build sequence

1. [done] Add path helpers in `src/common/paths.ts`: `HLVM_SKILLS_SEGMENT`,
   `getUserSkillsDir()`.
2. [done] Add `src/hlvm/agent/skills/` with `types.ts`, `store.ts`, `prompt.ts`,
   and `reserved.ts`. Reuse `parseFrontmatter()` from
   `src/common/frontmatter.ts`.
3. [done] Implement frontmatter-only scanning of
   `~/.hlvm/skills/<skill-name>/SKILL.md`, source tagging, validation,
   size/symlink hardening, and reserved-name filtering in `store.ts`.
4. [done] Add `maybeInjectSkills(...)` beside `maybeInjectMemoryRecall(...)` in
   [src/hlvm/agent/orchestrator.ts](/Users/seoksoonjang/dev/hql/src/hlvm/agent/orchestrator.ts).
   Inject only the compact index, not full skill bodies, and refresh the prior
   index across persistent turns.
5. [done] Add `src/hlvm/cli/commands/skill.ts` with `list`, `new`, and `info`.
   Register `skill` in
   [src/hlvm/cli/cli.ts](/Users/seoksoonjang/dev/hql/src/hlvm/cli/cli.ts). Keep
   `edit` optional.
6. [done] Extend
   [src/hlvm/cli/repl/commands.ts](/Users/seoksoonjang/dev/hql/src/hlvm/cli/repl/commands.ts)
   so `getFullCommandCatalog()` appends discovered skills and unknown slash
   commands can resolve to a skill instead of immediately erroring.
7. [done] Reuse the existing `SKILL_MARKER` path in
   [src/hlvm/cli/repl-ink/components/App.tsx](/Users/seoksoonjang/dev/hql/src/hlvm/cli/repl-ink/components/App.tsx)
   to turn `/skill-name ...` into a normal agent turn with injected recipe text.
8. [done] Add narrow tests under existing suites:
   - `tests/unit/agent/skills-*.test.ts` for parsing, scanning, and precedence
   - `tests/unit/agent/orchestrator.test.ts` for prompt injection
   - `tests/unit/cli/skill-command.test.ts` for CLI behavior
9. [done] Verify with narrow commands only: relevant `deno test ...` targets,
   `deno check`, `deno task ssot:check`, and `git diff --check`.

### Landed first cut

- Core loader
- Prompt injection
- `hlvm skill list`
- `hlvm skill new`
- `hlvm skill info`
- No `edit`
- No Hermes-style generation

This is the smallest useful merge. It creates real interoperability and a real
authoring surface without dragging registry or auto-generation into the critical
path.

### Landed follow-up cuts

- Dynamic skill entries in slash-command catalog
- `/skill-name` activation path using the existing marker plumbing
- Shared explicit activation path for REPL and `hlvm ask`
- Foundational bundled skills materialized to `~/.hlvm/.runtime/bundled-skills`
- Official agentskills.io optional frontmatter parsing: `license`,
  `compatibility`, `metadata`, and experimental `allowed-tools`
- Local/Git/GitHub import/install through one `install.ts` pipeline. It stages,
  validates, rejects symlinks/oversized trees, copies only to `~/.hlvm/skills`,
  and never runs install hooks.
- Real user-facing E2E verification with Claude Code Max-auth Haiku 4.5:
  explicit `/debug`, automatic model-chosen `debug-flow`, explicit installed git
  skill, and automatic model-chosen installed git skill all load successfully

---

## 15. Current peer-review status

### Shipped behavior

```text
Global roots:
  user     ~/.hlvm/skills/*/SKILL.md
  bundled  ~/.hlvm/.runtime/bundled-skills/*/SKILL.md

Discovery:
  loadSkillSnapshot()
    -> capped SKILL.md reads
    -> non-symlink files only
    -> official frontmatter parse
    -> user > bundled precedence
    -> compact <available_skills> prompt index

Activation:
  automatic  model sees index, reads SKILL.md through normal read_file
  explicit   /skill-name args -> injected skill recipe -> normal agent loop
```

### Shipped bundled skills

- `debug`
- `verify`
- `code-review`
- `refactor`
- `plan`
- `write-docs`
- `skill-author`

### Verification evidence

```text
Narrow tests:
  52 focused skill/unit+narrow-integration tests passed

Broad deterministic user E2E:
  28/28 checks passed
  Covered:
    hlvm skill --help
    hlvm skill list
    hlvm skill new
    duplicate/invalid-name failures
    hlvm skill draft
    hlvm skill draft --print
    hlvm skill draft --force
    hlvm skill info
    hlvm skill import <folder>
    hlvm skill import <pack>
    hlvm skill install <git-file-url>
    hlvm skill update <name>
    indexed hlvm skill search
    indexed hlvm skill info --remote
    indexed hlvm skill install <slug> --version
    hlvm skill check --json
    hlvm skill publish --print
    hlvm skill publish --repo
    duplicate publish failure
    hlvm skill remove
    hlvm skill update --all
    final hlvm skill check

Live AI E2E with claude-code/claude-haiku-4-5-20251001:
  hlvm skill draft ai-diagnose ... --ai
    -> created valid ~/.hlvm/skills/ai-diagnose/SKILL.md
    -> origin: authored draft
    -> skill check clean

  hlvm skill improve ai-diagnose ... --save
    -> updated existing SKILL.md
    -> origin: authored improve
    -> verification section included requested process-exit/prompt-return checks
    -> skill check clean

  hlvm ask --verbose "/ai-diagnose ..."
    -> [Tool] Skill(ai-diagnose)
    -> Successfully loaded skill
    -> model followed skill and answered through normal agent loop

  hlvm ask --verbose "I need help diagnosing a CLI command..."
    -> model selected ai-diagnose from <available_skills>
    -> read_file on installed SKILL.md
    -> [Tool] Skill(ai-diagnose)
    -> Successfully loaded skill

Real remote GitHub E2E against github.com/hlvm-dev/skills:
  hlvm skill search debug
    -> debug returned from official static index

  hlvm skill install debug
    -> cloned https://github.com/hlvm-dev/skills.git
    -> installed skills/debug into ~/.hlvm/skills/debug

  hlvm skill info debug
    -> source: user
    -> origin: git https://github.com/hlvm-dev/skills.git (skills/debug)
    -> commit and content hash shown

  hlvm skill check
    -> 7 ready, 0 warnings, 0 errors

  hlvm skill update debug
    -> debug already up to date

Compiled binary smoke:
  ./scripts/compile-hlvm.sh --output /tmp/hlvm-skill-comprehensive-bin
    -> compiled and signed binary

  /tmp/hlvm-skill-comprehensive-bin skill list
    -> bundled skills visible from compiled binary

  /tmp/hlvm-skill-comprehensive-bin skill draft bin-debug ...
    -> authored user skill created

  /tmp/hlvm-skill-comprehensive-bin skill check
    -> 8 ready, 0 warnings, 0 errors

Static checks:
  deno check passed for changed skill files/tests
  deno lint passed for changed skill files/tests
  deno task ssot:check passed
  git diff --check passed
```

### Code quality status

The foundation is intentionally small and SSOT-bound:

- KISS: one loader/store; no special skill executor.
- DRY: one shared activation helper for REPL and `hlvm ask`; one shared
  lifecycle pipeline for scaffold/import/install/update/remove/check.
- SSOT: paths in `src/common/paths.ts`; loading in
  `src/hlvm/agent/skills/store.ts`; prompt formatting in
  `src/hlvm/agent/skills/prompt.ts`; skill lifecycle copy/clone/update/check in
  `src/hlvm/agent/skills/install.ts`; AI draft/improve normalization in
  `src/hlvm/agent/skills/authoring.ts`; repository search/install/publish in
  `src/hlvm/agent/skills/repository.ts`.
- No backdoor: skills only become instructions for the normal agent loop.
- No project scope: global user and bundled roots only.
- No CC dialect creep: CC-only fields such as hooks, model routing, aliases,
  argument hints, and agent/context fields are not part of v1.

### What is intentionally not done yet

- No full third-party dangerous-code scanner yet; Phase 4 only rejects symlinks,
  oversized files/trees, and metadata directories, and warns on `scripts/`.
- No dependency installer or env/config injection.
- No passive Hermes-style workflow-to-skill suggestion/generation.
- No silent background skill creation or mutation.
- Experimental `allowed-tools` is parsed as official metadata but is not yet
  enforced as runtime policy.

---

## 16. Final vision — what complete HLVM skills look like

Complete means HLVM has a stable, SSOT-compliant skills layer that users can
trust for daily work. It does **not** mean cloning every CC or OpenClaw feature.

### User-visible final shape

```text
User creates or installs skills:

  ~/.hlvm/skills/verify/SKILL.md
  ~/.hlvm/skills/debug/SKILL.md

User can inspect and author them:

  hlvm skill list
  hlvm skill info verify
  hlvm skill new incident-debug
  hlvm skill search debug
  hlvm skill install debug
  hlvm skill import ./skill-or-pack
  hlvm skill install github:owner/repo/path/to/skill
  hlvm skill update --all
  hlvm skill remove incident-debug
  hlvm skill check

User can rely on automatic activation:

  hlvm ask "debug the failing repl test"
    -> HLVM shows the model available skills
    -> model reads debug/SKILL.md only if useful
    -> model follows the recipe using normal tools

User can force activation in the REPL:

  /debug why does ask hang after tool output?
    -> same agent loop
    -> skill recipe included as context
    -> no special tool execution path
```

### ASCII journey map

```text
                         HLVM SKILLS JOURNEY

  Phase 0             Phase 1             Phase 2
  Direction           Core Runtime         REPL Invocation
  ---------           ------------         ---------------
  [x] SSOT read       [x] path helpers     [x] catalog entries
  [x] CC read         [x] scan roots       [x] slash resolve
  [x] OpenClaw read   [x] parse SKILL.md   [x] SKILL_MARKER
  [x] role model      [x] precedence       [x] invocation tests
        |             [x] prompt XML              |
        |             [x] skill CLI               |
        v                    |                    v
  +--------------------------+--------------------+
  |        agentskills.io-compatible HLVM core    |
  +--------------------------+--------------------+
                             |
                             v
  Phase 3             Phase 4/4.1         Phase 4.2            Phase 5/8
  Bundled Core        Distribution         GitHub Index         Author + Share
  ------------        ------------         ------------         --------------
  [x] verify          [x] import path      [x] index schema     [x] template draft
  [x] debug           [x] install GitHub   [x] search slug      [x] AI draft
  [x] code-review     [x] validate pack    [x] install slug     [x] AI improve
  [x] refactor        [x] staging/force    [x] remote info      [x] publish package
  [x] plan            [x] symlink/size           |              [ ] passive suggest
  [x] write-docs      [x] update/remove          |                    |
  [x] skill-author    [x] check/audit            |                    |
        |                   v                    v                    v
        +---------->  Complete HLVM Skills  <-------------------------+

  Complete HLVM Skills =
    portable SKILL.md support
    + global user/bundled roots
    + compact prompt awareness
    + on-demand body loading
    + CLI authoring/inspection
    + REPL slash activation
    + foundational bundled skills
    + safe ecosystem import/install
    + package-manager lifecycle
    + explicit authored skill drafting
    + AI-assisted skill draft/improve with validation
    + official GitHub-backed repository search/install
    + PR-ready publish packaging
    + user-reviewed workflow capture
```

### What matches CC, what matches OpenClaw, what is HLVM-specific

| Area              | HLVM final direction                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Format            | Same common `agentskills.io` `SKILL.md` contract used by CC, OpenClaw, and Hermes.                                |
| Runtime shape     | HLVM-native: lightweight prompt/runtime feature, compact index, normal read tools, normal agent loop.             |
| CLI UX            | Current: `list`, `new`, `search`, `info`, `import`, `install`, `update`, `remove`, `check`, plus install-by-slug. |
| Slash activation  | Common behavior: `/skill-name args`; HLVM maps it to a normal user turn instead of special dispatch.              |
| Safety            | Borrow OpenClaw ideas: path containment, size caps, staging, command-name sanitization, no install hooks.         |
| Bundled skills    | HLVM-specific foundational coding-agent skills, not CC's or OpenClaw's exact pack.                                |
| Advanced features | Demand-driven. Do not build CC/OpenClaw/Hermes product-dialect features just because they exist.                  |

### Explicit non-goals for "complete v1"

- Not exact CC parity.
- Not exact OpenClaw parity.
- No OpenClaw registry or ClawHub clone.
- No custom hosted registry server for the next cut; use the official HLVM
  GitHub static repository first.
- No dependency installer or secrets/config injection layer.
- No hot-reload watcher.
- No plugin skill merge.
- No Hermes-style automatic self-generated skills.
- No new execution substrate for scripts; skills continue to use normal agent
  tools.
