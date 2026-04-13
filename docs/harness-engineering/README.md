# HLVM Harness Engineering

CC-inspired harness primitives for the HLVM agent runtime.
Not interface-compatible with Claude Code — HLVM diverges intentionally
with multi-provider support and global-session architecture.

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
cat > ~/.hlvm/skills/deploy.md << 'EOF'
---
description: "Deploy to staging"
allowed_tools: [shell_exec]
context: inline
---
Run the deploy. Target: ${ARGS}
EOF

# 5. Use it
/deploy staging.example.com
```
