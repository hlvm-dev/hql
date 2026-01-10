!ultrathink

Commit ALL files (staged, unstaged, and untracked) with a proper commit message:

1. Run `git status` to see all files
2. Run `git diff` to see changes in modified files
3. Run `git diff --cached` to see staged changes
4. Stage ALL files: `git add -A`
5. Generate a clear, descriptive commit message based on the changes
6. Create the commit with proper formatting

Use this commit message format:
```
<type>(<scope>): <summary>

<body - what changed and why>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat, fix, refactor, docs, test, chore, perf, style

$ARGUMENTS
