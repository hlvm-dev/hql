# Non-Interactive Usage Guide

Comprehensive guide for using HLVM in CI/CD pipelines, scripts, and automation.

---

## Table of Contents

1. [Overview](#overview)
2. [Basic Non-Interactive Mode](#basic-non-interactive-mode)
3. [CI/CD Integration](#cicd-integration)
4. [Scripting Patterns](#scripting-patterns)
5. [Exit Codes](#exit-codes)
6. [Output Formats](#output-formats)
7. [Common Use Cases](#common-use-cases)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Overview

**Non-interactive mode** (`-p`/`--print`) enables fully automated HLVM agent execution without user interaction. When `-p` is used without an explicit `--permission-mode`, it defaults to `dontAsk` mode:

- **No prompts** -- agent never asks for permission
- **Safe by default** -- unsafe tools auto-denied
- **Deterministic** -- predictable behavior
- **Exit codes** -- 0 for success, 1 for any error

**Use cases:**
- CI/CD quality gates
- Automated code reviews
- Security scanning
- Documentation generation
- Test analysis

---

## Basic Non-Interactive Mode

### Minimal Example

```bash
hlvm ask -p "analyze code quality in src/"
```

**Behavior:**
- Agent reads files, searches code, analyzes structure
- Agent cannot write files, execute shell commands, or commit
- Execution completes automatically (no prompts)
- Exit code 0 on success, non-zero on error

---

### Long Form

```bash
hlvm ask --print "analyze code quality in src/"
```

**Identical to** `-p` (short form recommended).

---

### Permission Behavior

| Tool Level | Action | Example |
|------------|--------|---------|
| L0 (safe) | Auto-approve | `read_file`, `search_code` |
| L1 (mutations) | Auto-deny | `write_file`, `edit_file` |
| L2 (destructive) | Auto-deny | `shell_exec` (dangerous), `delete_file` |

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Code Quality Gate
on: [push, pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup HLVM
        run: |
          curl -fsSL https://hlvm.dev/install.sh | sh
          echo "$HOME/.hlvm/bin" >> $GITHUB_PATH

      - name: Code Quality Analysis
        run: |
          hlvm ask -p "analyze src/ for code smells and anti-patterns" \
            > quality-report.txt

      - name: Check for Critical Issues
        run: |
          if grep -qi "critical" quality-report.txt; then
            echo "::error::Critical code quality issues found"
            cat quality-report.txt
            exit 1
          fi

      - name: Upload Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: quality-report
          path: quality-report.txt
```

---

### GitLab CI/CD

```yaml
code_quality:
  stage: test
  image: hlvm/hlvm:latest
  script:
    - hlvm ask -p "review code for security vulnerabilities" > security.txt
    - cat security.txt
    - |
      if grep -qi "vulnerability" security.txt; then
        echo "Security issues detected!"
        exit 1
      fi
  artifacts:
    paths:
      - security.txt
    when: always
  only:
    - merge_requests
```

---

### Jenkins Pipeline

```groovy
pipeline {
  agent any

  environment {
    HLVM_MODEL = 'anthropic/claude-sonnet-4-5-20250929'
  }

  stages {
    stage('Code Analysis') {
      steps {
        sh '''
          hlvm ask -p --model $HLVM_MODEL \
            "analyze changes for potential bugs" \
            > analysis.txt
          cat analysis.txt
        '''
      }
    }

    stage('Quality Gate') {
      steps {
        script {
          def report = readFile('analysis.txt')
          if (report.toLowerCase().contains('critical')) {
            error('Critical issues found in analysis')
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'analysis.txt', allowEmptyArchive: true
    }
  }
}
```

---

### CircleCI

```yaml
version: 2.1

jobs:
  analyze:
    docker:
      - image: hlvm/hlvm:latest
    steps:
      - checkout
      - run:
          name: Code Quality Check
          command: |
            hlvm ask -p "check for unused imports and dead code" \
              > cleanup-report.txt
            cat cleanup-report.txt
      - store_artifacts:
          path: cleanup-report.txt

workflows:
  version: 2
  analyze_code:
    jobs:
      - analyze
```

---

## Scripting Patterns

### Bash Script with Error Handling

```bash
#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Function to run analysis
run_analysis() {
  local query="$1"
  local output_file="$2"

  echo "Running analysis: $query"

  if hlvm ask -p "$query" > "$output_file" 2>&1; then
    echo "✓ Analysis complete: $output_file"
    return 0
  else
    local exit_code=$?
    echo "✗ Analysis failed (exit code: $exit_code)"
    cat "$output_file" >&2
    return $exit_code
  fi
}

# Run multiple analyses
run_analysis "check TypeScript types" "types.txt"
run_analysis "check import consistency" "imports.txt"
run_analysis "check naming conventions" "naming.txt"

echo "All analyses completed successfully"
```

---

### Python Integration

```python
#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

def run_hlvm_analysis(query: str, output_file: str | None = None) -> str:
    """Run HLVM analysis in non-interactive mode."""
    cmd = ["hlvm", "ask", "-p", query]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=300  # 5 minute timeout
        )

        output = result.stdout

        if output_file:
            Path(output_file).write_text(output)
            print(f"✓ Results saved to {output_file}")

        return output

    except subprocess.CalledProcessError as e:
        print(f"✗ Analysis failed (exit {e.returncode})", file=sys.stderr)
        print(f"Error: {e.stderr}", file=sys.stderr)
        sys.exit(e.returncode)
    except subprocess.TimeoutExpired:
        print("✗ Analysis timed out", file=sys.stderr)
        sys.exit(1)

# Usage
if __name__ == "__main__":
    output = run_hlvm_analysis(
        "analyze test coverage and identify gaps",
        "coverage-analysis.txt"
    )

    # Check for issues
    if "low coverage" in output.lower():
        print("⚠ Low test coverage detected")
        sys.exit(1)

    print("✓ Test coverage is adequate")
```

---

### Node.js Integration

```javascript
#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs').promises;

async function runHlvmAnalysis(query, outputFile = null) {
  return new Promise((resolve, reject) => {
    const proc = spawn('hlvm', ['ask', '-p', query]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        if (outputFile) {
          await fs.writeFile(outputFile, stdout);
          console.log(`✓ Results saved to ${outputFile}`);
        }
        resolve(stdout);
      } else {
        console.error(`✗ Analysis failed (exit ${code})`);
        console.error(stderr);
        reject(new Error(`Exit code ${code}`));
      }
    });
  });
}

// Usage
(async () => {
  try {
    const output = await runHlvmAnalysis(
      'find potential performance bottlenecks',
      'performance-report.txt'
    );

    if (output.toLowerCase().includes('bottleneck')) {
      console.warn('⚠ Performance issues detected');
      process.exit(1);
    }

    console.log('✓ No performance issues found');
  } catch (error) {
    process.exit(1);
  }
})();
```

---

## Exit Codes

HLVM uses simple exit codes:

| Code | Meaning | Example Cause |
|------|---------|---------------|
| `0` | Success | Analysis completed without errors |
| `1` | Error | LLM API failure, network timeout, tool blocked, invalid arguments, or any other error |

All errors (execution failures, tool blocks, validation errors) now use exit code 1.

### Exit Code Handling

```bash
#!/bin/bash

hlvm ask -p "analyze code"
exit_code=$?

if [ $exit_code -eq 0 ]; then
  echo "Success"
else
  echo "Failed (exit code: $exit_code)"
  exit 1
fi
```

---

## Output Formats

### Plain Text (Default)

```bash
hlvm ask -p "summarize recent changes" > summary.txt
```

**Output:** Human-readable text.

**Use case:** Reports, logs, documentation.

---

### JSON (Structured)

```bash
hlvm ask -p --json "analyze code" > output.jsonl
```

**Output:** Newline-delimited JSON events.

**Event types:**
- `token` — Streamed text tokens
- `agent_event` — Tool calls and results
- `final` — Final response with stats
- `error` — Execution errors

**Example:**

```json
{"type":"tool_end","name":"read_file","success":true,"content":"..."}
{"type":"final","text":"Analysis complete.","stats":{"messageCount":5}}
```

**Use case:** Programmatic processing, metrics.

---

### Verbose Mode (Debugging)

```bash
hlvm ask -p --verbose "analyze code" 2>&1 | tee verbose.log
```

**Output:** Detailed trace events, tool calls, timing.

**⚠️ Cannot combine** `--verbose` and `--json`.

**Use case:** Debugging, performance analysis.

---

## Common Use Cases

### Use Case 1: Quality Gate

```bash
#!/bin/bash
# Pre-commit hook or CI step

hlvm ask -p "check staged changes for code smells" > quality.txt

if grep -qiE "critical|major|blocker" quality.txt; then
  echo "❌ Code quality gate failed:"
  cat quality.txt
  exit 1
fi

echo "✅ Code quality check passed"
```

---

### Use Case 2: Security Audit

```bash
#!/bin/bash
# Daily security scan

DATE=$(date +%Y-%m-%d)
REPORT="security-audit-${DATE}.txt"

hlvm ask -p \
  --model anthropic/claude-sonnet-4-5-20250929 \
  "scan codebase for security vulnerabilities" \
  > "$REPORT"

# Alert if vulnerabilities found
if grep -qi "vulnerability" "$REPORT"; then
  # Send alert (email, Slack, etc.)
  echo "⚠ Security issues found - check $REPORT"
  exit 1
fi

echo "✓ No security issues detected"
```

---

### Use Case 3: Test Coverage Analysis

```bash
#!/bin/bash
# CI step after test run

hlvm ask -p \
  --attach ./coverage/coverage.json \
  "analyze test coverage and identify untested code paths" \
  > coverage-analysis.txt

# Parse coverage percentage
COVERAGE=$(grep -oP 'coverage: \K\d+' coverage-analysis.txt || echo "0")

if [ "$COVERAGE" -lt 80 ]; then
  echo "❌ Coverage below 80% ($COVERAGE%)"
  cat coverage-analysis.txt
  exit 1
fi

echo "✅ Coverage: $COVERAGE%"
```

---

### Use Case 4: Dependency Audit

```bash
#!/bin/bash
# Weekly dependency check

hlvm ask -p \
  "analyze package.json for outdated or vulnerable dependencies" \
  > deps-audit.txt

# Check for issues
if grep -qiE "outdated|vulnerable|deprecated" deps-audit.txt; then
  echo "⚠ Dependency issues found"
  cat deps-audit.txt
  # Create GitHub issue
  gh issue create \
    --title "Dependency audit found issues" \
    --body-file deps-audit.txt
fi
```

---

### Use Case 5: Documentation Sync Check

```bash
#!/bin/bash
# CI step to verify docs match code

hlvm ask -p "verify README.md accurately reflects CLI flags" || {
  echo "❌ Documentation out of sync"
  exit 1
}

echo "✓ Documentation is up to date"
```

---

### Use Case 6: PR Review Bot

```bash
#!/bin/bash
# GitHub Actions workflow

PR_NUMBER="${GITHUB_REF#refs/pull/}"
PR_NUMBER="${PR_NUMBER%/merge}"

hlvm ask -p \
  "review PR #${PR_NUMBER} for best practices violations" \
  > pr-review.txt

# Post as PR comment
gh pr comment "$PR_NUMBER" --body-file pr-review.txt

echo "✓ Review posted to PR #${PR_NUMBER}"
```

---

## Best Practices

### 1. Always Use Non-Interactive Mode in Automation

```bash
# Good
hlvm ask -p "query"

# Bad - might hang waiting for input
hlvm ask "query"
```

---

### 2. Capture Output for Debugging

```bash
# Save both stdout and stderr
hlvm ask -p "query" > output.txt 2>&1
```

---

### 3. Set Explicit Timeouts

```bash
# Bash timeout
timeout 300 hlvm ask -p "query" || echo "Timed out"

# Python timeout
subprocess.run(cmd, timeout=300)
```

---

### 4. Use Specific Queries

```bash
# ✅ Good - specific
hlvm ask -p "analyze src/auth.ts for security issues"

# ❌ Bad - too vague
hlvm ask -p "analyze"
```

---

### 5. Pin Model Versions

```bash
# ✅ Good - predictable
hlvm ask -p --model anthropic/claude-sonnet-4-5-20250929 "query"

# ⚠ Acceptable - uses default (may change)
hlvm ask -p "query"
```

---

### 6. Check Exit Codes

```bash
# ✅ Good
if hlvm ask -p "query"; then
  echo "Success"
else
  echo "Failed with code $?"
  exit 1
fi

# ❌ Bad - ignores errors
hlvm ask -p "query"
echo "Done"
```

---

### 7. Use JSON for Parsing

```bash
# ✅ Good - structured data
hlvm ask -p --json "query" | jq '.type == "final"'

# ⚠ Acceptable - but harder to parse
hlvm ask -p "query" | grep "pattern"
```

---

### 8. Document Tool Permissions

```bash
#!/bin/bash
# Non-interactive mode with write permission for doc generation
# Requires: write_file tool for output

hlvm ask -p --allowedTools write_file "generate API docs"
```

---

## Troubleshooting

### Problem: No Output Generated

**Symptoms:** Empty output file, no results.

**Cause:** Query too vague or no matching files.

**Solution:**

```bash
# ❌ Bad
hlvm ask -p "analyze"

# ✅ Good
hlvm ask -p "analyze src/main.ts for TypeScript errors"
```

---

### Problem: Exit Code 1 (Error)

**Symptoms:** Script fails with exit code 1.

**Cause:** LLM API failure, network timeout, tool blocked, or runtime error.

**Solutions:**

1. **Check API credentials:**
   ```bash
   echo $ANTHROPIC_API_KEY  # Should be set
   ```

2. **Retry with exponential backoff:**
   ```bash
   for i in 1 2 3; do
     hlvm ask -p "query" && break || sleep $((i * 5))
   done
   ```

3. **Check logs:**
   ```bash
   hlvm ask -p "query" 2>&1 | tee error.log
   ```

---

### Problem: Immediate Failure (Validation Error)

**Symptoms:** Script fails immediately with exit code 1.

**Cause:** Invalid flags or missing query.

**Solution:**

```bash
# Bad - missing model name
hlvm ask -p --model

# Good
hlvm ask -p --model openai/gpt-4o "query"
```

---

### Problem: Timeout in CI

**Symptoms:** Job times out after 10+ minutes.

**Cause:** Query too broad or model stalled.

**Solution:**

1. **Set explicit timeout:**
   ```bash
   timeout 300 hlvm ask -p "query" || exit 1
   ```

2. **Use faster model:**
   ```bash
   hlvm ask -p --model anthropic/claude-haiku-4-5 "query"
   ```

3. **Narrow query scope:**
   ```bash
   # ❌ Too broad
   hlvm ask -p "analyze entire codebase"

   # ✅ Focused
   hlvm ask -p "analyze src/auth/ for security issues"
   ```

---

### Problem: Inconsistent Results

**Symptoms:** Same query produces different outputs.

**Cause:** LLM non-determinism.

**Solution:**

1. **Use temperature 0 (if supported):**
   ```bash
   # Model-specific — check docs
   hlvm ask -p "query"  # Uses model defaults
   ```

2. **Pin model version:**
   ```bash
   hlvm ask -p --model anthropic/claude-sonnet-4-5-20250929 "query"
   ```

3. **Make query more specific:**
   ```bash
   # ❌ Vague
   hlvm ask -p "check code"

   # ✅ Specific
   hlvm ask -p "check for unused variables in src/utils.ts"
   ```

---

## Advanced Patterns

### Parallel Analyses

```bash
#!/bin/bash
# Run multiple analyses in parallel

hlvm ask -p "check TypeScript types" > types.txt &
PID1=$!

hlvm ask -p "check import consistency" > imports.txt &
PID2=$!

hlvm ask -p "check naming conventions" > naming.txt &
PID3=$!

# Wait for all to complete
wait $PID1 $PID2 $PID3

# Combine reports
cat types.txt imports.txt naming.txt > full-report.txt
echo "✓ All analyses complete"
```

---

### Conditional Execution

```bash
#!/bin/bash
# Only analyze changed files

CHANGED_FILES=$(git diff --name-only main..HEAD | grep "\.ts$")

if [ -n "$CHANGED_FILES" ]; then
  echo "Analyzing: $CHANGED_FILES"
  hlvm ask -p "analyze TypeScript changes: $CHANGED_FILES"
else
  echo "No TypeScript files changed"
fi
```

---

### Incremental Analysis

```bash
#!/bin/bash
# Analyze only new files since last run

LAST_ANALYSIS=".last-analysis-timestamp"

if [ -f "$LAST_ANALYSIS" ]; then
  SINCE=$(cat "$LAST_ANALYSIS")
  NEW_FILES=$(find src/ -type f -newer "$SINCE" -name "*.ts")

  if [ -n "$NEW_FILES" ]; then
    echo "New files: $NEW_FILES"
    hlvm ask -p "analyze new files: $NEW_FILES"
  fi
fi

touch "$LAST_ANALYSIS"
```

---

## See Also

- [Claude Code Migration Guide](./claude-code-migration.md) — Migrating from Claude Code
- [CLI Permission Modes](./CLI.md#permission-modes) — Full permission documentation
- [Agent System Architecture](./agent.md) — Technical reference
