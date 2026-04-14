# HLVM Harness Engineering

CC-inspired harness primitives for the HLVM agent runtime.
Not interface-compatible with Claude Code — HLVM diverges intentionally
with multi-provider support and global-session architecture.

The skill surface is now intentionally CC-shaped inside `.hlvm`: use
`.hlvm/skills/<name>/SKILL.md` as the canonical path and `.hlvm/commands/*.md`
only as a legacy migration path.

## Documents

| Document | Purpose |
|----------|---------|
| [Reference](./reference.md) | **Authoritative** technical reference |
| [CC vs HLVM](./cc-vs-hlvm.md) | Historical — initial research (overstates parity) |
| [Gap Analysis](./gap-analysis.md) | Historical — planning document |
| [System Map](./system-map.md) | Historical — pipeline diagrams (overstates parity) |

## Quick Start

```bash
# 1. Initialize
/init

# 2. See available skills
/skills

# 3. Use a skill
/commit fix the login bug

# 4. Create your own
mkdir -p ~/.hlvm/skills/deploy
cat > ~/.hlvm/skills/deploy/SKILL.md << 'EOF'
---
description: "Deploy to staging"
argument-hint: "[target]"
allowed-tools: Bash Read
context: inline
---
Run the deploy. Target: $ARGUMENTS
EOF

# 5. Use it
/deploy staging.example.com

# 6. Legacy migration path also works
cat > ~/.hlvm/commands/lint.md << 'EOF'
---
description: "Run lint"
disable-model-invocation: true
---
Run the project linter. Target: $ARGUMENTS
EOF
```
