!ultrathink

Find and identify any stupid logic and code that must be rewritten or fixed:

- **HUGE WINS ONLY** - Focus on code that provides significant improvement when fixed, not nitpicks
- **Broken logic** - Code that works by accident, has race conditions, or incorrect assumptions
- **Fundamentally wrong approaches** - Using completely wrong patterns for the problem at hand
- **Obvious performance disasters** - N+1 queries, loading entire datasets when one item is needed
- **Copy-paste nightmares** - Large blocks of duplicated code that should be abstracted
- **Dangerous code** - Security holes, data corruption risks, silent failures hiding real problems
- **Overcomplicated mess** - 100 lines that should be 10, complex state machines for simple tasks

**NOT looking for**: Style issues, missing comments, minor naming improvements, theoretical edge cases, "nice to have" refactors

## Output Format

Report findings as a prioritized list:

1. **[SEVERITY: CRITICAL/HIGH/MEDIUM]** - File:line - Brief description
   - What's wrong
   - Why it matters (impact)
   - Suggested fix approach

**DO NOT fix anything** - this is an audit/report only. Let me decide what to prioritize.

## Arguments (optional)

You can specify:
- **Target path**: `src/parser/` - only audit this directory/file
- **Focus area**: `focus on error handling` - narrow the audit scope
- **Severity filter**: `critical only` - only report critical issues

Examples:
- `/jss-audit-stupid src/interpreter/` - audit only interpreter code
- `/jss-audit-stupid focus on async code` - focus on async/promise handling
- `/jss-audit-stupid src/repl critical only` - critical issues in REPL only

$ARGUMENTS
