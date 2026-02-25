# 22. Comments

HQL supports three comment styles:

- **Line comments:** `//` or `;;` (Lisp-style, preferred in .hql files)
- **Block comments:** `/* ... */` (multi-line)
- **Shebang:** `#!/usr/bin/env hlvm` (first line only)

All comments are stripped during tokenization and do not appear in compiled output.

## Files

- [spec.md](spec.md) - Full specification
- [examples.hql](examples.hql) - Usage examples
