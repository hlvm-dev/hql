# HLVM Harness Engineering

Agent harness infrastructure inspired by Claude Code. Gives users control over
agent behavior through composable instructions, reusable skill workflows,
lifecycle hooks, and headless safety bounds.

## Documents

| Document | Purpose |
|----------|---------|
| [Reference](./reference.md) | Complete technical reference — every feature, file, config format |
| [CC vs HLVM Comparison](./cc-vs-hlvm.md) | Side-by-side comparison with Claude Code |
| [Gap Analysis](./gap-analysis.md) | What was missing, what was built, what remains |
| [System Map](./system-map.md) | ASCII pipeline diagrams — before/after, user scenarios |

## Quick Start

```bash
# 1. Initialize harness directories
hlvm   # then type: /init

# 2. See available skills
/skills

# 3. Invoke a skill
/commit fix the login bug
/test src/auth/
/review src/auth.ts

# 4. Create your own skill
cat > ~/.hlvm/skills/deploy.md << 'EOF'
---
description: "Deploy to staging"
allowed_tools: [shell_exec]
context: inline
---
Run the deploy. Target: ${ARGS}
EOF

# 5. See it in the list
/skills

# 6. Use it
/deploy staging.example.com
```
