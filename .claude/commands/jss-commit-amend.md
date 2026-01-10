!ultrathink

Amend the LAST commit with all current changes (staged, unstaged, and untracked):

1. Run `git log -1 --format='%an %ae'` to verify YOU are the author (NEVER amend others' commits)
2. Run `git status` to see all files
3. Run `git diff` to see changes in modified files
4. Stage ALL files: `git add -A`
5. Review existing commit message with `git log -1 --format='%B'`
6. Amend the commit, updating the message if the changes warrant it

Use `git commit --amend` with this format:
```
<type>(<scope>): <summary>

<body - what changed and why>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Safety checks before amending:**
- ONLY amend if the last commit is yours (check author)
- ONLY amend if NOT pushed yet (`git status` shows "Your branch is ahead")
- If already pushed, create a NEW commit instead

Types: feat, fix, refactor, docs, test, chore, perf, style

$ARGUMENTS
