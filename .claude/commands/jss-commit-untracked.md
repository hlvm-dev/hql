Commit only UNTRACKED (new) files with a proper commit message:

1. Run `git status --porcelain` to identify untracked files (lines starting with ??)
2. Review the new files to understand what's being added
3. Stage ONLY untracked files: `git add` each untracked file individually
4. Do NOT stage modified files (M) or deleted files (D)
5. Generate a clear commit message describing the new additions
6. Create the commit

Use this commit message format:
```
<type>(<scope>): <summary>

<body - what new files were added and why>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: feat (new feature files), docs (new documentation), test (new test files), chore (new config/build files)

$ARGUMENTS
