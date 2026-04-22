# HLVM Skills System

**Status**: NOT IMPLEMENTED — product direction is mostly settled; repo reality checked on 2026-04-21; ready to turn into implementation work.
**Owner**: unassigned
**Target scope for v1**: OpenClaw-style local platform, no registry, no auto-generation.

This doc is a complete cold-start briefing. If you are a new AI or engineer with zero prior context, read top-to-bottom once and you will know exactly what to build, why, and in what order.

---

## 1. The one-paragraph summary

HLVM should support **Skills** — the open `agentskills.io` standard for agent procedural knowledge. A skill is a folder containing a `SKILL.md` file with YAML frontmatter (name + description) and a markdown body (the recipe), plus optional `scripts/`, `references/`, and `assets/` subfolders. At startup the agent scans known skill roots, indexes the frontmatter, and injects a compact `<available_skills>` block into the system prompt. When a task matches a skill's description, the model reads the body on demand. It is prompt engineering made portable, packaged, and auto-discoverable. Every major agent tool has adopted this format (Claude Code, Cursor, GitHub Copilot, Codex, Gemini CLI, OpenClaw, Hermes, Databricks, and ~30 more). HLVM not having it is a visible gap, not a differentiator.

---

## 2. What `agentskills.io` is

- An open specification originated by Anthropic for Claude Code, then extracted to its own site so other tools could interop.
- Spec site: `https://agentskills.io` (adopters list, specification page).
- Reference implementation: `github.com/anthropics/skills`.
- The spec itself is tiny: directory layout, SKILL.md frontmatter schema, discovery contract. Fits on one page.
- It is to skills what MCP is to tools: a portable format that means "write once, run anywhere."

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
- Fill form    → use scripts/fill.py
- Merge files  → use scripts/merge.py

## Common edge cases
- Scanned PDFs need OCR first (see references/ocr.md)
- Encrypted PDFs require the password arg
```

Required frontmatter keys: `name` (kebab-case, 1–64 chars), `description` (one-line, used for matching).

Everything else in the spec (license, metadata, optional hooks) is optional and agent-specific.

### Mental model

```
Tool    = a verb (code that does X)        — e.g. read_file, shell_exec
MCP     = remote tool server protocol       — modelcontextprotocol.io
Skill   = a RECIPE for using verbs well    — agentskills.io
Memory  = facts about the user over time    — HLVM has this (V3)
Prompt  = one-shot system message
```

Tools and skills are complementary, not competing. A skill often teaches the model **how to use tools well for task X**.

---

## 3. How competitors implement skills

All three use the same agentskills.io foundation. They differ only in the authoring surface and distribution platform around it.

| Feature | CC | OpenClaw | Hermes |
|---|---|---|---|
| agentskills.io SKILL.md format | yes | yes | yes |
| Frontmatter parser, on-demand body load | yes | yes | yes |
| `<available_skills>` XML in prompt | yes | yes | yes |
| Bundled skills in binary | yes | yes | yes |
| Precedence tiers | 3 | 6 | 3 |
| Dynamic discovery (walk up from edited file) | **yes** | no | no |
| Conditional skills via `paths:` frontmatter | **yes** | no | no |
| CLI: `skills new` scaffolding | no | **yes** | yes |
| CLI: `skills list` / `info` | no | **yes** | yes |
| Slash command `/skill-name` | yes | yes | yes |
| Gating via `metadata.*.requires.{bins,env,config}` | no | **yes** | partial |
| Per-agent skill allowlists | no | **yes** | no |
| Env injection scoped to agent run | no | **yes** | no |
| Public registry | no | **ClawHub** | GitHub only |
| `skills install <slug>` | no | **yes** | no |
| Dangerous-code scanner | no | **yes** | no |
| GUI skill manager | no | **yes** (macOS) | no |
| Hot-reload watcher | memoize | yes | yes |
| Agent auto-generates SKILL.md from trajectories | no | no | **yes** |
| "Self-improving" marketing frame | no | no | **yes** |

### Reading this table

- **CC** is the lean end. One loader file, ~1000 lines, memoized. Smart additions: dynamic discovery walks up from files being edited to find nested `.claude/skills/` dirs; conditional skills activate only when file paths match the `paths:` frontmatter. No registry because CC is a code assistant, not a platform.

- **OpenClaw** is the heavy end. ~60 files across parsing, gating, install, registry (ClawHub), security scanning, macOS GUI. Solves the distribution problem: skills declare their dependencies (`requires.bins`, `requires.env`), and the UI can auto-install them. Per-agent allowlists because OpenClaw supports multi-agent workspaces.

- **Hermes** is the marketing-forward middle. Simpler than OpenClaw, no registry. Unique feature: after a successful multi-step task, the agent is prompted to distill the trajectory into a SKILL.md. This is what gets marketed as "self-improving AI." The mechanism is real. The framing is overclaimed — reviewers report the auto-generated skills are often trivial or duplicative, and the separate Atropos RL work is not in the live hot path.

### One-line takeaways

```
CC        "a developer tool, keep it lean"
OpenClaw  "a full personal-AI platform"
Hermes    "a self-improving agent brand"
```

---

## 4. Why HLVM must implement this

1. **It is the norm, not a copy.** ~35 tools have adopted. Not supporting it reads as a gap, the way not supporting Markdown would.
2. **Zero existing skill concept in HLVM.** Confirmed by grep over `src/hlvm/agent/` — there is nothing to refactor, only something to add.
3. **The core spec is tiny.** A loader, a frontmatter parser, and one prompt-injection hook. Everything else (registry, install, UI) is optional scaffolding.
4. **Execution piggybacks on existing tools.** Skill bodies reference `scripts/foo.py` — the agent calls it via the existing `shell_exec` tool. SKILL.md body is read via the existing Read tool. No new execution path.
5. **It is the highest-ROI single feature HLVM can ship.** ~1 week of work → unlocks compatibility with every SKILL.md ever written for any adopter.

---

## 5. Three implementation tiers considered

| Tier | What it includes | LOC | Days | Fit |
|---|---|---|---|---|
| **A** — CC-style | Load skills users drop in folders. No CLI, no scaffold. | ~300 | 3 | feels half-done |
| **B** — OpenClaw-style minus registry | A + `hlvm skill new/list/info` + `/skill-name` REPL. | ~700 | 7 | **recommended** |
| **C** — Hermes-style | B + agent writes own SKILL.md after successful tasks. | ~900 | 10 | defer |

### Why B is the recommended v1

- A alone leaves users hand-mkdir'ing skills. Feels unfinished.
- C's auto-generation is additive. You can add it in ~3 days on top of B if demand appears. The cost of waiting is zero.
- C's quality is uncertain. Hermes reviewers report the auto-generated skills are noisy. Shipping untested auto-generation risks skill-spam and creates a curation problem (who prunes bad generated skills?).
- B gives HLVM full parity with OpenClaw's consumption layer and every skill written for Anthropic, Cursor, Codex, OpenClaw, or Hermes runs here unchanged.

---

## 6. V1 scope — recommended (tier B)

### In v1

| Feature | Notes |
|---|---|
| SKILL.md parsing | Standard agentskills.io frontmatter. Plain YAML. |
| Skill roots | `~/.hlvm/skills/` + `<cwd>/.hlvm/skills/` + bundled (shipped in binary). |
| Three-tier precedence | workspace > user > bundled. Keep it simple. |
| On-demand body load | Index frontmatter at startup. Body read via existing Read tool on match. |
| `<available_skills>` XML injection | New hook in orchestrator Stage 3, alongside `maybeInjectMemoryRecall`. |
| Scripts / references / assets | No new code needed. Skill body references paths; existing shell/read tools handle them. |
| CLI: `hlvm skill list` | Table: name, description, source, status. |
| CLI: `hlvm skill new <name>` | Scaffold `SKILL.md` + optional `scripts/`. |
| CLI: `hlvm skill info <name>` | Show frontmatter + first N lines of body. |
| CLI: `hlvm skill edit <name>` | Open `$EDITOR`. |
| REPL slash commands | `/skill-name <args>` invokes skill body as a user turn. |
| Session snapshot | Scan-once at session start, reuse per turn. |

### Deferred to v2+ (only if demand appears)

| Feature | Why deferred |
|---|---|
| Dynamic discovery (walk up from edited file) | CC-specific polish. Real value unclear for HLVM's use cases. |
| Conditional skills via `paths:` frontmatter | Same. |
| Hot-reload watcher | Restart is fine for v1. |
| `metadata.*.requires.{bins,env,config}` gating | Useful but adds complexity. Users can read SKILL.md to see what's needed. |
| Per-agent skill allowlists | HLVM's agent-team module already has scoping. Revisit when it conflicts. |
| `hlvm skill install <slug>` / registry | No registry exists to install from yet. Premature. |
| Dangerous-code scanner | Security hardening. Add when third-party installs become a real path. |
| Trajectory → SKILL auto-generation (Hermes) | Quality uncertain. Add only after observing how users actually author skills. |
| macOS GUI skill manager | OpenClaw-style polish. Defer until there's a clear user ask. |

---

## 7. Architecture — where it plugs in

```
src/hlvm/agent/skills/          NEW — only new subsystem in v1
  store.ts        scan skill roots, parse frontmatter, build index
  loader.ts       read SKILL.md body on demand (wraps Read tool)
  prompt.ts       serialize index into <available_skills> XML block
  matcher.ts      optional v2: score skills against user prompt
  types.ts        Skill, SkillIndex, SkillSource

src/hlvm/cli/commands/
  skill.ts        NEW — list / new / info / edit / rm subcommands

src/hlvm/cli/repl/handlers/
  (existing slash-command dispatcher gains /skill-name routing)

src/hlvm/agent/orchestrator.ts or its Pre-LLM stage:
  Add one call:  maybeInjectSkills(state, userPrompt)
  Placement: alongside maybeInjectMemoryRecall.

tests/unit/skills/              NEW — loader, frontmatter, precedence, matching
tests/smoke/skills/             NEW — end-to-end via hlvm ask
```

### Integration points (what NOT to touch)

- **Memory V3** — skills are not memory. Do not extend `memory_write`. A skill is procedural knowledge the user or agent authored; memory is facts observed over time. Different subsystems.
- **MCP client** — skills are not MCP tools. Skills are markdown recipes; MCP is remote tool protocol. They sit at different layers.
- **Provider layer** — skills are prompt-side. Nothing in `providers/` needs to change.
- **Tools registry** — skills reuse existing tools. No new tool surface.

### Data flow per user prompt

```
startup (cached)
  scan ~/.hlvm/skills/*/SKILL.md
  scan <cwd>/.hlvm/skills/*/SKILL.md
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

## 8. Open questions for the human

These are decisions the human should make before writing the plan. If already answered in later messages, skip.

1. **Confirm tier B.** Do we build full local platform (B, ~7 days) or start with read-only (A, ~3 days)?
2. **Slash-command semantics.** Should `/skill-name <args>` inject the skill body *as the user's next turn* (natural), or dispatch directly to a tool when the frontmatter declares `command-dispatch: tool` (OpenClaw behavior)? Recommend: user-turn only for v1.
3. **Bundled skills — which ones?** OpenClaw ships ~15. Start with 2–3 HLVM-specific ones (e.g. `kakao-send`, `computer-use-session`, `chrome-extension-debug`) and iterate.
4. **Authoring UX polish.** `hlvm skill new <name>` — interactive prompts (description, scripts?) or just scaffold a minimal file and open `$EDITOR`? Recommend: minimal scaffold + `$EDITOR`.
5. **Namespacing.** A bundled skill and a user skill with the same name — does user win (simple precedence) or do we surface both with warning? Recommend: user wins, log once at startup.

---

## 9. Next steps

1. Human confirms tier B (or picks A/C).
2. Human answers the five open questions above.
3. Someone invokes the brainstorming skill for the specific questions that remain uncertain.
4. Someone invokes the writing-plans skill to produce a step-by-step implementation plan.
5. Plan execution (single session via executing-plans skill, or subagent-driven if broken into parallel tracks).
6. Ship v1, collect a week of usage feedback, then decide on tier-C auto-generation and tier-2 deferred features.

---

## 10. References

- `agentskills.io` — spec and adopter list.
- `github.com/anthropics/skills` — Anthropic reference skills.
- `~/dev/ClaudeCode-main/skills/loadSkillsDir.ts` — CC's loader (local copy for reading).
- `~/dev/openclaw-main/src/agents/skills/` — OpenClaw's skill subsystem (local copy).
- `~/dev/openclaw-main/docs/tools/skills.md` — OpenClaw skills doc (thorough reference).
- `docs/agent-loop/` — HLVM's existing agent architecture; the place skills plug in.
- `AGENTS.md` — HLVM project guidelines. Especially "Simplicity first" and "SSOT."

---

## 11. Decisions already locked in

- agentskills.io SKILL.md format is non-negotiable. HLVM adopts the standard as-is. No HLVM-specific frontmatter extensions in v1.
- No registry in v1. Users drop skills into folders or clone repos.
- No auto-generation in v1. Add only if post-launch evidence justifies it.
- Skills are not memory, not tools, not MCP. New subsystem, narrow scope.
- `src/hlvm/agent/skills/` is the only new directory. Single hook point in the orchestrator. Reuse existing Read + shell_exec for execution.

## 12. Assumptions the next AI should verify

- That `src/hlvm/agent/orchestrator.ts` still exposes a Pre-LLM stage hook like `maybeInjectMemoryRecall`. If this has moved or been renamed, skills injection goes in its new location.
- That the REPL slash-command dispatcher is in `src/hlvm/cli/repl/handlers/`. Path names may have shifted.
- That `~/dev/ClaudeCode-main` and `~/dev/openclaw-main` still contain the clones referenced above. If not, re-fetch from their respective sources.
- That the HLVM CLI command registry still uses the same registration pattern as `src/hlvm/cli/commands/serve.ts` and peers. Model `skill.ts` after an existing command.

---

## 13. Repo reality check and working execution plan (2026-04-21)

This section updates the original brief against the current HLVM tree so the next person can build from repo truth, not just product intent.

### What still holds

- `src/common/frontmatter.ts` already provides the YAML frontmatter parsing needed for `SKILL.md`.
- `src/hlvm/agent/orchestrator.ts` still has the exact kind of prompt-injection seam this feature needs: `maybeInjectMemoryRecall(...)` plus a call site in the main loop.
- `src/common/paths.ts` already models user/project directories for adjacent concepts (`~/.hlvm/agents`, `.hlvm/agents`), so skills should mirror that pattern rather than inventing a new path system.
- `src/hlvm/cli/cli.ts` still uses a simple command registry, so adding `hlvm skill ...` is straightforward.
- `src/hlvm/cli/repl-ink/components/App.tsx` still contains a `SKILL_MARKER` re-submit path. That means slash-skill execution can piggyback on an existing UI affordance instead of inventing a new one.

### What is stale in the original brief

- "HLVM has zero skill concept" is only partly true now. There is still no actual agent skills subsystem, but there is leftover REPL/TUI scaffolding and design docs that assume skill activation exists or will exist soon.
- The current slash-command path is not `src/hlvm/cli/repl/handlers/`; the live command surface is `src/hlvm/cli/repl/commands.ts`.
- `getFullCommandCatalog()` currently returns built-ins only, and the source comment explicitly says `skills removed`.
- The proposed test layout should follow existing repo structure: `tests/unit/agent/...` and `tests/unit/cli/...`, not brand-new top-level `tests/unit/skills/` and `tests/smoke/skills/` buckets.
- "Bundled skills in binary" is not a free add-on. HLVM does have embedded asset patterns elsewhere, but there is no existing skill-specific markdown asset pipeline. Do not let bundled skills block the first merge.

### Working decisions now

- Build **tier B**, but do it in two cuts: `B1 core` first, `B2 ergonomics` second.
- Keep the open `agentskills.io` `SKILL.md` contract unchanged in v1. No HLVM-specific frontmatter keys.
- Slash commands should use the simple v1 behavior: `/skill-name <args>` becomes a normal user turn with the skill recipe injected, not a special tool-dispatch path.
- Precedence should stay simple: `project > user > bundled` if bundled skills exist. Duplicate names resolve by precedence, not by showing both.
- No registry in v1.
- No Hermes-style trajectory-to-skill auto-generation in v1.
- Bundled skills are **optional** for the first merge. Shipping the loader/CLI/REPL surface without bundled examples is acceptable if that keeps scope honest.

### Still not fully decided

- Whether first ship should include `0` bundled skills or `1-3` HLVM-specific example skills.
- Whether `hlvm skill edit` belongs in the first merge or follows `list/new/info`.
- Whether duplicate-name shadowing should warn only in logs or also surface in `hlvm skill list`.
- Whether v1 must wire dynamic skill commands into both Ink REPL and TUI v2 immediately, or whether Ink first is acceptable and v2 parity follows right after.

### Recommended build sequence

1. Add path helpers in `src/common/paths.ts`: `HLVM_SKILLS_SEGMENT`, `getUserSkillsDir()`, `getProjectSkillsDir(workspace)`.
2. Add `src/hlvm/agent/skills/` with `types.ts`, `store.ts`, and `prompt.ts`. Reuse `parseFrontmatter()` from `src/common/frontmatter.ts`.
3. Implement frontmatter-only scanning of `<root>/<skill-name>/SKILL.md`, source tagging, validation, and precedence resolution in `store.ts`.
4. Add `maybeInjectSkills(...)` beside `maybeInjectMemoryRecall(...)` in [src/hlvm/agent/orchestrator.ts](/Users/seoksoonjang/dev/hql/src/hlvm/agent/orchestrator.ts). Inject only the compact index, not full skill bodies.
5. Add `src/hlvm/cli/commands/skill.ts` with `list`, `new`, and `info`. Register `skill` in [src/hlvm/cli/cli.ts](/Users/seoksoonjang/dev/hql/src/hlvm/cli/cli.ts). Keep `edit` optional.
6. Extend [src/hlvm/cli/repl/commands.ts](/Users/seoksoonjang/dev/hql/src/hlvm/cli/repl/commands.ts) so `getFullCommandCatalog()` appends discovered skills and unknown slash commands can resolve to a skill instead of immediately erroring.
7. Reuse the existing `SKILL_MARKER` path in [src/hlvm/cli/repl-ink/components/App.tsx](/Users/seoksoonjang/dev/hql/src/hlvm/cli/repl-ink/components/App.tsx) to turn `/skill-name ...` into a normal agent turn with injected recipe text.
8. Add narrow tests under existing suites:
   - `tests/unit/agent/skills-*.test.ts` for parsing, scanning, and precedence
   - `tests/unit/agent/orchestrator.test.ts` for prompt injection
   - `tests/unit/cli/skill-command.test.ts` for CLI behavior
9. Verify with narrow commands only: relevant `deno test ...` targets plus `deno task ssot:check`.

### Suggested first PR cut

- Core loader
- Prompt injection
- `hlvm skill list`
- `hlvm skill new`
- `hlvm skill info`
- No bundled skills
- No `edit`
- No Hermes-style generation

This is the smallest useful merge. It creates real interoperability and a real authoring surface without dragging asset packaging or REPL polish into the critical path.

### Suggested second PR cut

- Dynamic skill entries in slash-command catalog
- `/skill-name` activation path using the existing marker plumbing
- Optional `hlvm skill edit`
- One bundled example skill only if packaging is straightforward
