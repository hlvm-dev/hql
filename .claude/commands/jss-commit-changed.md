!ultrathink

Commit only CHANGED (modified/deleted) files with a proper commit message:

1. Run `git status --porcelain` to identify changed files (lines starting with M, D, or space+M/D)
2. Run `git diff` to review the actual changes
3. Stage ONLY modified/deleted files: `git add -u` (stages tracked files only, excludes untracked)
4. Do NOT stage untracked files (??)
5. Generate a clear commit message describing what was changed
6. Create the commit

Use this commit message format:
```
<type>(<scope>): <summary>

<body - what changed and why>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: fix (bug fixes), refactor (code restructuring), perf (performance), style (formatting), docs (doc updates)

$ARGUMENTS
