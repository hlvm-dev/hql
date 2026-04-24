# HLVM Skills System

**Status**: Phase 1 foundation implemented as of 2026-04-25. **Owner**: skills
foundation **Target scope for v1**: `agentskills.io`-compatible core, CC-style
runtime behavior, small CLI surface, global user skills, no registry, no
auto-generation.

This doc is a complete cold-start briefing. If you are a new AI or engineer with
zero prior context, read top-to-bottom once and you will know exactly what to
build, why, and in what order.

---

## 1. The one-paragraph summary

HLVM supports **Skills** — the open `agentskills.io` standard for agent
procedural knowledge. A skill is a folder containing a `SKILL.md` file with YAML
frontmatter (name + description) and a markdown body (the recipe), plus optional
`scripts/`, `references/`, and `assets/` subfolders. The agent scans known skill
roots, indexes the frontmatter, and injects a compact `<available_skills>` block
into the system prompt. When a task matches a skill's description, the model
reads the body on demand; when the user explicitly invokes `/<skill-name>`, the
skill body is attached to a normal agent turn. It is prompt engineering made
portable, packaged, and auto-discoverable.

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

Everything else in the spec (license, metadata, optional hooks) is optional and
agent-specific.

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
2. **No real skills subsystem exists in HLVM yet.** There is some leftover
   REPL/TUI scaffolding and planning language, but no actual agent skills
   runtime to refactor. The main work is still additive.
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
Primary implementation model: Claude Code
Selective donor pieces: OpenClaw
Not for v1: Hermes auto-generation / self-improving flow
```

This does **not** mean "copy CC exactly" or "build OpenClaw parity." It means
HLVM implements the portable common core natively, using CC as the default shape
and OpenClaw as a checklist for hardening and local UX.

### Why this is the current best recommendation

- **`agentskills.io`** is the non-negotiable compatibility target. That is the
  format HLVM should accept.
- **Claude Code** is the better role model because it treats skills as a
  **lightweight prompt/runtime feature**, not a separate product platform.
- **OpenClaw** is still useful, but mainly as a donor for a few practical
  implementation pieces: path containment, prompt XML formatting, prompt-budget
  behavior, CLI command sanitization, and multi-source precedence tests.
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
- Prompt-budget awareness
- Basic path containment / traversal hardening

#### OpenClaw-specific product features HLVM should NOT treat as v1 requirements

- ClawHub registry (`search`, `install`, `update`)
- `metadata.openclaw.*` installer and gating model
- `skills.entries.*` config/env/apiKey injection
- Gateway / operator RPC methods for skills
- Watcher / hot-reload
- Sandbox skill mirroring
- Plugin skill merging into the same resolver
- Dangerous-code scanning for third-party installs
- GUI skills manager

### Plain-language restatement

For HLVM v1, "skills support" should mean:

```text
read standard skills
+ expose them to the model
+ let the user invoke them locally
```

It should **not** mean:

```text
build a registry
+ build installer orchestration
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
| CLI: `hlvm skill new <name>`       | Scaffold `SKILL.md` + optional `scripts/`.                                              |
| CLI: `hlvm skill info <name>`      | Show frontmatter + first N lines of body.                                               |
| CLI: `hlvm skill edit <name>`      | Open `$EDITOR`.                                                                         |
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
| `hlvm skill install <slug>` / registry                         | No registry exists to install from yet. Premature.                                             |
| Dangerous-code scanner                                         | Security hardening. Add when third-party installs become a real path.                          |
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

src/hlvm/cli/commands/
  skill.ts        NEW — list / new / info subcommands; edit is optional later

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

Do not add OpenClaw metadata, dependency requirements, per-agent filters,
command dispatch, registry IDs, or config/env fields in v1.

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
- If prompt-budget limits are added in B1, use a compact fallback before
  dropping skills. Otherwise leave the hook obvious for Phase 4.

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
hlvm skill info <name>
```

Rules:

- `list` shows name, source, path, and description.
- `new` creates `<target>/<name>/SKILL.md` with valid frontmatter and a minimal
  body.
- `info` shows frontmatter and a short body preview.
- Default `new` target is `~/.hlvm/skills`; no project/local target.
- No registry, install, update, dependency checks, env injection, or
  auto-generation.

### B1 acceptance criteria

- A user skill at `~/.hlvm/skills/debug/SKILL.md` appears in `hlvm skill list`.
- A runtime-target skill at `./.hlvm/skills/debug/SKILL.md` is ignored.
- The orchestrator injects a compact `<available_skills>` block containing only
  name, description, and location.
- The full `SKILL.md` body is not injected unless the model or slash command
  explicitly reads/invokes it.
- `hlvm skill new example-skill` creates a valid agentskills.io folder.
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
5. **Precedence is simple.** Project overrides user, user overrides bundled.
   Duplicate names resolve by precedence.
6. **No platform expansion.** No registry, installer orchestration,
   secrets/config layer, GUI manager, watcher, plugin merge, or auto-generation
   in v1.

### Still open while implementing

1. **Bundled skills timing.** First PR can ship with zero bundled skills if
   packaging would slow the loader/CLI merge. The foundational pack should
   follow immediately.
2. **`hlvm skill edit`.** Optional for first PR. `list/new/info` are required.
3. **Duplicate reporting.** Prefer `hlvm skill list` surfacing shadowed
   duplicates in a compact note, plus a debug log. If that adds churn, log-only
   is acceptable for B1.
4. **TUI v2 parity.** Ink REPL support is required for B2. TUI v2 parity can
   follow unless the live command surface makes it cheap.

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

- [ ] Add skills path helpers in `src/common/paths.ts`.
- [ ] Add `src/hlvm/agent/skills/types.ts`.
- [ ] Add `src/hlvm/agent/skills/store.ts` for frontmatter-only scanning,
      validation, source tagging, precedence, and duplicate handling.
- [ ] Add `src/hlvm/agent/skills/prompt.ts` for compact `<available_skills>`
      XML.
- [ ] Hook `maybeInjectSkills(...)` beside `maybeInjectMemoryRecall(...)`.
- [ ] Add `src/hlvm/cli/commands/skill.ts`.
- [ ] Register `hlvm skill list`.
- [ ] Register `hlvm skill new <name>`.
- [ ] Register `hlvm skill info <name>`.
- [ ] Add narrow unit tests for parsing, scanning, precedence, and prompt
      serialization.
- [ ] Run relevant narrow `deno test ...` targets.
- [ ] Run `deno task ssot:check`.

### Phase 2 — B2 REPL invocation

- [ ] Extend `getFullCommandCatalog()` with discovered skills.
- [ ] Resolve unknown slash commands against the skill index before returning
      "unknown command."
- [ ] Reuse the existing Ink `SKILL_MARKER` path to submit `/skill-name <args>`
      as an agent turn with recipe text attached.
- [ ] Add completion/catalog tests for dynamic skill slash entries.
- [ ] Add REPL command tests for skill invocation and missing-skill behavior.
- [ ] Verify that a runtime-target skill from `.hlvm/skills/<name>/SKILL.md` is
      ignored.
- [ ] Run `deno task ssot:check`.

### Phase 3 — foundational bundled skills

- [ ] Decide the bundled-skill asset path and binary packaging mechanism.
- [ ] Add `verify`.
- [ ] Add `debug`.
- [ ] Add `code-review`.
- [ ] Add `plan`.
- [ ] Add `write-docs`.
- [ ] Add `skill-author`.
- [ ] Ensure user skills can override bundled skills by name.
- [ ] Add tests proving bundled skills do not block user precedence.
- [ ] Run `deno task ssot:check`.

### Phase 4 — hardening and polish

- [ ] Add path containment tests for symlink/path escape attempts.
- [ ] Add file-size and large-root guardrails if B1 did not include them.
- [ ] Add prompt-budget fallback or truncation when the skill catalog is large.
- [ ] Add concise duplicate-shadowing visibility in `hlvm skill list` if not
      already present.
- [ ] Consider `hlvm skill edit <name>` if the first users want it.
- [ ] Run relevant narrow tests and `deno task ssot:check`.

### Phase 5 — later advanced features, demand-driven only

- [?] Dynamic nested discovery from touched file paths, CC-style.
- [?] Conditional skills via `paths:` frontmatter, CC-style.
- [?] Registry/install/search/update, OpenClaw-style.
- [?] Dependency gating via `requires.{bins,env,config}`, OpenClaw-style.
- [?] Per-agent skill allowlists.
- [?] Dangerous-code scanner for third-party installs.
- [?] Hermes-style "suggest saving this workflow as a skill" with explicit user
  review.

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
- No registry in v1. Users drop skills into folders or clone repos.
- No auto-generation in v1. Add only if post-launch evidence justifies it.
- Skills are not memory, not tools, not MCP. New subsystem, narrow scope.
- `src/hlvm/agent/skills/` is the only new directory. Single hook point in the
  orchestrator. Reuse existing Read + shell_exec for execution.
- The role-model choice is locked for v1: `agentskills.io` for compatibility, CC
  for implementation style, OpenClaw only for selective donor pieces.
- HLVM v1 is **not** "full OpenClaw parity".
  Registry/installers/gateway-admin/config-heavy pieces are out of scope unless
  a later product decision explicitly brings them in.

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
- "Bundled skills in binary" is not a free add-on. HLVM does have embedded asset
  patterns elsewhere, but there is no existing skill-specific markdown asset
  pipeline. Do not let bundled skills block the first merge.

### Working decisions now

- Build **tier B**, but do it in two cuts: `B1 core` first, `B2 ergonomics`
  second.
- Keep the open `agentskills.io` `SKILL.md` contract unchanged in v1. No
  HLVM-specific frontmatter keys.
- Follow **CC as the primary runtime role model**. Use OpenClaw only as a
  selective donor for a few practical pieces, not as the product template for
  the whole subsystem.
- Slash commands should use the simple v1 behavior: `/skill-name <args>` becomes
  a normal user turn with the skill recipe injected, not a special tool-dispatch
  path.
- Precedence should stay simple: `user > bundled` if bundled skills exist.
  Duplicate names resolve by precedence, not by showing both.
- No registry in v1.
- No Hermes-style trajectory-to-skill auto-generation in v1.
- Bundled skills are **optional** for the first merge, but the core bundled set
  should be foundational when it lands: `verify`, `debug`, `code-review`,
  `plan`, `write-docs`, `skill-author`.
- OpenClaw-only platform pieces (`ClawHub`, `metadata.openclaw.*`,
  `skills.entries.*`, gateway skills RPC, watcher, sandbox mirroring) are
  **not** required for HLVM v1.

### Still not fully decided

- Whether first ship should include `0` bundled skills or the foundational
  starter set. Do not ship product/domain examples as the first bundled set.
- Whether `hlvm skill edit` belongs in the first merge or follows
  `list/new/info`.
- Whether v1 must wire dynamic skill commands into both Ink REPL and TUI v2
  immediately, or whether Ink first is acceptable and v2 parity follows right
  after.

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

### Suggested first PR cut

- Core loader
- Prompt injection
- `hlvm skill list`
- `hlvm skill new`
- `hlvm skill info`
- No bundled skills
- No `edit`
- No Hermes-style generation

This is the smallest useful merge. It creates real interoperability and a real
authoring surface without dragging asset packaging or REPL polish into the
critical path.

### Suggested second PR cut

- Dynamic skill entries in slash-command catalog
- `/skill-name` activation path using the existing marker plumbing
- Optional `hlvm skill edit`
- Optional bundled-skill packaging spike if it is straightforward

---

## 15. Final vision — what complete HLVM skills look like

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
  [x] SSOT read       [ ] path helpers     [ ] catalog entries
  [x] CC read         [ ] scan roots       [ ] slash resolve
  [x] OpenClaw read   [ ] parse SKILL.md   [ ] SKILL_MARKER
  [x] role model      [ ] precedence       [ ] invocation tests
        |             [ ] prompt XML              |
        |             [ ] skill CLI               |
        v                    |                    v
  +--------------------------+--------------------+
  |        agentskills.io-compatible HLVM core    |
  +--------------------------+--------------------+
                             |
                             v
  Phase 3             Phase 4             Phase 5
  Bundled Core        Hardening            Later Advanced
  ------------        ---------            --------------
  [ ] verify          [ ] path escape      [?] dynamic discovery
  [ ] debug           [ ] size caps        [?] paths: filters
  [ ] code-review     [ ] prompt budget    [?] registry/install
  [ ] plan            [ ] duplicate UX     [?] dependency gating
  [ ] write-docs      [ ] edit command     [?] skill suggestions
  [ ] skill-author          |                    |
        |                   v                    v
        +---------->  Complete HLVM Skills  <----+

  Complete HLVM Skills =
    portable SKILL.md support
    + global user/bundled roots
    + compact prompt awareness
    + on-demand body loading
    + CLI authoring/inspection
    + REPL slash activation
    + foundational bundled skills
    + safety and prompt-budget guardrails
```

### What matches CC, what matches OpenClaw, what is HLVM-specific

| Area              | HLVM final direction                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Format            | Same common `agentskills.io` `SKILL.md` contract used by CC and OpenClaw.                                |
| Runtime shape     | Closest to CC: lightweight prompt/runtime feature, scan once, inject compact index, read body on demand. |
| CLI UX            | OpenClaw-lite: `list`, `new`, `info`, maybe `edit`; no registry in v1.                                   |
| Slash activation  | Common behavior: `/skill-name args`; HLVM maps it to a normal user turn instead of special dispatch.     |
| Safety            | Borrow OpenClaw ideas: path containment, size caps, suspicious-root limits, command-name sanitization.   |
| Bundled skills    | HLVM-specific foundational coding-agent skills, not CC's or OpenClaw's exact pack.                       |
| Advanced features | Demand-driven. Do not build OpenClaw platform features just because they exist.                          |

### Explicit non-goals for "complete v1"

- Not exact CC parity.
- Not exact OpenClaw parity.
- No OpenClaw registry or ClawHub clone.
- No dependency installer or secrets/config injection layer.
- No hot-reload watcher.
- No plugin skill merge.
- No Hermes-style automatic self-generated skills.
- No new execution substrate for scripts; skills continue to use normal agent
  tools.
