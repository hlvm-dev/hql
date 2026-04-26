import { getBundledSkillsDir } from "../../../common/paths.ts";
import { getPlatform } from "../../../platform/platform.ts";

interface BundledSkillAsset {
  name: string;
  content: string;
}

const BUNDLED_SKILLS: readonly BundledSkillAsset[] = [
  {
    name: "debug",
    content: `---
name: debug
description: Use when investigating a bug, failing test, runtime error, flaky behavior, or unexpected output.
---

# Debug

Use this skill to diagnose a failure before changing code.

## Workflow

1. State the symptom precisely.
2. Reproduce it with the narrowest command or user action available.
3. Trace the path from user-visible behavior to the owning code.
4. Identify the root cause, not just the nearest failing line.
5. Make the smallest fix that removes the root cause.
6. Verify with the narrowest relevant test or manual check.

## Guardrails

- Do not guess from the symptom alone.
- Do not add retries, sleeps, broad timeouts, or fallback paths unless the failure is truly transient.
- Do not edit unrelated code while debugging.
- If another agent changed the area, inspect the current file before editing.

## Response Shape

When useful, close with:

- Root cause
- Fix
- Verified
- Remaining risk
`,
  },
  {
    name: "verify",
    content: `---
name: verify
description: Use when checking that a code change, CLI behavior, UI flow, or bug fix actually works.
---

# Verify

Use this skill to prove a change works through real checks.

## Workflow

1. Identify the behavior that must be true.
2. Pick the narrowest verification that exercises that behavior.
3. Prefer real commands over visual inspection.
4. For CLI or agent behavior, run the command path users actually use.
5. For UI behavior, verify the rendered state when possible.
6. Report what passed, what failed, and what was not tested.

## Check Selection

- Unit test: use when the behavior is pure logic or state transition.
- Integration test: use when multiple modules must work together.
- E2E/manual smoke: use when the value is user-visible.
- Static check: use for type, formatting, lint, or SSOT boundaries.

## Guardrails

- Do not claim E2E coverage from unit tests.
- Do not bypass the production path just to make a test pass.
- Do not run broad suites if a narrow test proves the change.
- If a command cannot run, say exactly why.
`,
  },
  {
    name: "code-review",
    content: `---
name: code-review
description: Use when reviewing a diff or implementation for bugs, regressions, security issues, and missing tests.
---

# Code Review

Use this skill to review code with a bug-finding mindset.

## Workflow

1. Read the diff and identify the intended behavior.
2. Trace changed paths through callers and tests.
3. Look for real defects: incorrect behavior, regressions, security/privacy issues, data loss, race conditions, and missing verification.
4. Ignore style nits unless they hide a real maintainability risk.
5. Prioritize findings by severity.

## Output Rules

- Findings first.
- Include file and line references when possible.
- If there are no findings, say so and name residual risks.
- Keep summaries short and secondary.

## Guardrails

- Do not invent issues from speculation.
- Do not approve untested high-risk behavior without calling out the gap.
- Do not ask for broad rewrites when a surgical fix is enough.
`,
  },
  {
    name: "refactor",
    content: `---
name: refactor
description: Use when simplifying code, removing duplication, enforcing SSOT, or reducing accidental complexity.
---

# Refactor

Use this skill to improve structure without changing user-visible behavior.

## Workflow

1. Define the behavior that must remain unchanged.
2. Find duplication, dead code, hidden alternate paths, and needless abstractions.
3. Move logic toward the existing owner instead of creating a new subsystem.
4. Delete or inline code when it makes the result easier to read.
5. Keep the diff small enough to review.
6. Run focused verification.

## HLVM Principles

- KISS: prefer the simplest direct implementation.
- DRY: remove real duplication, not harmless repetition.
- SSOT: each rule has one owner.
- No backdoors: no parallel paths, hidden modes, or special-case executors.

## Guardrails

- Do not refactor across unrelated domains in the same change.
- Do not preserve unused abstractions "just in case".
- Do not change public behavior unless the user asked for it.
`,
  },
  {
    name: "plan",
    content: `---
name: plan
description: Use when breaking a larger implementation, migration, or ambiguous task into concrete phases.
---

# Plan

Use this skill to turn ambiguous work into a small executable plan.

## Workflow

1. Restate the goal in one sentence.
2. Identify the current state from repo evidence.
3. Split work into phases with clear exit criteria.
4. Put risky or foundational work before polish.
5. Name what is explicitly out of scope.
6. Keep the next action concrete.

## Output Shape

- Current state
- Target state
- Phases
- Risks
- Next step

## Guardrails

- Do not create process ceremony for simple tasks.
- Do not ask questions if the repo can answer them.
- Do not plan around unverified assumptions.
`,
  },
  {
    name: "write-docs",
    content: `---
name: write-docs
description: Use when creating or updating docs, SSOT notes, architecture summaries, or user-facing command documentation.
---

# Write Docs

Use this skill to document decisions and behavior clearly.

## Workflow

1. Identify the audience: user, contributor, maintainer, or future agent.
2. Find the existing SSOT doc before adding a new doc.
3. Update the smallest relevant section.
4. Describe behavior, decisions, constraints, and commands.
5. Remove stale statements that now conflict with reality.
6. Keep examples executable.

## Guardrails

- Do not duplicate architecture facts across multiple docs unless one points to the SSOT.
- Do not document aspirational behavior as shipped behavior.
- Do not bury decisions in long prose when a compact table or flow is clearer.
`,
  },
  {
    name: "skill-author",
    content: `---
name: skill-author
description: Use when creating, reviewing, or improving agentskills.io-compatible SKILL.md files.
---

# Skill Author

Use this skill to create or improve an agentskills.io skill.

## File Contract

A skill is a folder with:

- SKILL.md
- optional scripts/
- optional references/
- optional assets/

SKILL.md must start with agentskills.io frontmatter:

\`\`\`markdown
---
name: kebab-case-name
description: Use when the agent should apply this workflow.
license: MIT
compatibility: Requires git and network access.
metadata:
  author: example-org
allowed-tools: Bash(git:*) Read
---
\`\`\`

Only name and description are required. License, compatibility, metadata, and allowed-tools are optional official fields. Do not add product-specific fields unless the user explicitly asks for a product-specific dialect.

## Workflow

1. Make the description specific enough for model selection.
2. Keep the body procedural: when to use it, steps, guardrails, and expected output.
3. Put large reference material in references/ and tell the agent when to read it.
4. Put executable helpers in scripts/ only when markdown instructions are not enough.
5. Avoid product-specific claims unless the skill really requires that product.
6. Test explicit invocation with /skill-name args.

## Guardrails

- Do not create broad trigger descriptions like "use for coding".
- Do not hide secrets, API keys, or machine-specific absolute paths in bundled skills.
- Do not make a skill execute code directly; skills instruct the normal agent loop.
`,
  },
];

export function getBundledSkillNames(): readonly string[] {
  return BUNDLED_SKILLS.map((skill) => skill.name);
}

export async function materializeBundledSkills(): Promise<void> {
  const platform = getPlatform();
  const root = getBundledSkillsDir();
  await platform.fs.mkdir(root, { recursive: true });

  await Promise.all(
    BUNDLED_SKILLS.map(async (skill) => {
      const dir = platform.path.join(root, skill.name);
      const file = platform.path.join(dir, "SKILL.md");
      await platform.fs.mkdir(dir, { recursive: true });
      try {
        if ((await platform.fs.readTextFile(file)) === skill.content) {
          return;
        }
      } catch {
        // Missing or unreadable file: rewrite from the embedded source.
      }
      await platform.fs.writeTextFile(file, skill.content);
    }),
  );
}
