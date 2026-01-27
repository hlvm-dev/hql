# AI Agent Core: Comprehensive Review & Issues

**Date:** 2026-01-28
**Scope:** orchestrator.ts, llm-integration.ts, safety.ts, tool execution pipeline
**Status:** Critical issues found requiring immediate attention

---

## Executive Summary

**Verdict:** Core has good architecture but **fragile execution** with silent failures.

**Critical Issues:** 5
**High Priority:** 3
**Medium Priority:** 4
**Total:** 12 issues found

**Key Problem:** **Silent error handling** - Invalid tool calls are ignored without feedback to LLM, causing hallucinations.

---

## 🔴 Critical Issues (Must Fix)

### **Issue 1: Silent JSON Parsing Failure** ⚠️ **CRITICAL**

**File:** `orchestrator.ts:141-143`
**Severity:** CRITICAL
**Impact:** LLM hallucinations, invalid tool calls silently ignored

**Problem:**
```typescript
try {
  const json = jsonLines.join("\n");
  const parsed = JSON.parse(json);
  // ...
} catch {
  // Skip invalid JSON  ← ❌ SILENT FAILURE
}
```

**What happens:**
1. LLM generates invalid JSON (e.g., missing closing brace)
2. Parser silently skips it
3. No error message sent back to LLM
4. LLM thinks tool call succeeded but gets no result
5. LLM hallucinates the result (exactly what happened in your test!)

**Evidence from user's CLI output:**
```json
{"toolName": "shell_exec", "args": {"command": "echo $(($((2 + 2)))}"}
// ❌ Missing closing brace!
```

Tool stats showed "1 tool message" but LLM showed 2 tool calls → second was hallucinated.

**Fix Required:**
```typescript
} catch (parseError) {
  // Add error message to context so LLM knows it failed
  config.context?.addMessage({
    role: "tool",
    content: `ERROR: Invalid tool call JSON - ${parseError.message}\nJSON was: ${json}`
  });
}
```

**Priority:** Fix immediately - this is causing production failures

---

###**Issue 2: No Validation Error Reporting** ⚠️ **CRITICAL**

**File:** `orchestrator.ts:128-140`
**Severity:** CRITICAL
**Impact:** Structure validation failures are silent

**Problem:**
```typescript
if (
  typeof parsed === "object" &&
  parsed !== null &&
  "toolName" in parsed &&
  "args" in parsed &&
  typeof parsed.toolName === "string" &&
  typeof parsed.args === "object"
) {
  calls.push({...});
}
// ❌ No else branch - invalid structure silently ignored
```

**What should happen:**
- Invalid structure should generate error message
- LLM should be told WHY tool call failed
- User should see warning in trace mode

**Fix Required:**
Add else branch with error reporting to LLM.

---

### **Issue 3: Unclosed TOOL_CALL Blocks** ⚠️ **HIGH**

**File:** `orchestrator.ts:111-154`
**Severity:** HIGH
**Impact:** LLM forgets END_TOOL_CALL, entire tool call lost

**Problem:**
```typescript
for (const line of lines) {
  if (trimmed === TOOL_CALL_START) {
    inToolCall = true;
    // ...
  }
  if (trimmed === TOOL_CALL_END) {
    // Parse and execute
  }
}
// ❌ What if END_TOOL_CALL is never found?
// Answer: Tool call is silently lost!
```

**Edge case:**
```
TOOL_CALL
{"toolName": "read_file", "args": {"path": "foo.ts"}}
Oops I forgot END_TOOL_CALL and kept talking...
```

Result: Tool call never executed, LLM has no idea.

**Fix Required:**
Detect unclosed blocks at end of parsing, send error to LLM.

---

### **Issue 4: Prompt Doesn't Warn About Hallucination Risk** ⚠️ **HIGH**

**File:** `llm-integration.ts:186-299`
**Severity:** HIGH
**Impact:** LLM not warned that hallucinating tool results is forbidden

**Problem:**
System prompt says:
- ✅ "CITE TOOL RESULTS"
- ✅ "TRUST THE TOOL"
- ❌ **Missing:** "NEVER make up tool results"
- ❌ **Missing:** "Wait for [Tool Result] before answering"

**Evidence from user's test:**
LLM generated:
```
[Tool Result] stdout: "4"
```

But this was **NOT** from the orchestrator - LLM made it up!

**Fix Required:**
Add explicit instruction:
```
**NEVER FABRICATE TOOL RESULTS:**
- You CANNOT see tool results until they appear as [Tool Result]
- Do NOT write "[Tool Result]" in your own responses
- Wait for the system to provide tool results
- If you make up a tool result, it will be WRONG
```

---

### **Issue 5: Tool Call Format Not Strict Enough** ⚠️ **HIGH**

**File:** `llm-integration.ts:227-233`
**Severity:** HIGH
**Impact:** LLM uses variations of envelope format

**Problem:**
Prompt says:
```
TOOL_CALL
{"toolName": "tool_name", "args": {...}}
END_TOOL_CALL
```

But doesn't explicitly forbid:
- Indentation inside envelope
- Comments in JSON
- Multiple JSON objects in one envelope
- Extra whitespace

**Edge cases not handled:**
```
TOOL_CALL
  {"toolName": "foo", "args": {}}  ← Indented!
END_TOOL_CALL
```

```
TOOL_CALL
{"toolName": "foo", /* comment */ "args": {}}  ← JSON comment!
END_TOOL_CALL
```

**Fix Required:**
Make format rules explicit and strict.

---

## 🟡 High Priority Issues

### **Issue 6: No Line Number in Error Messages** ⚠️ **MEDIUM**

**File:** `orchestrator.ts:103-157`
**Severity:** MEDIUM
**Impact:** Hard to debug why tool call failed

**Problem:**
When JSON parsing fails, we don't know:
- Which line had the error
- What line number in LLM response
- What the surrounding context was

**Fix Required:**
Track line numbers, include in error messages.

---

### **Issue 7: Multiple Tool Calls Stop on First Error** ⚠️ **MEDIUM**

**File:** `orchestrator.ts:323-333`
**Severity:** MEDIUM
**Impact:** Remaining tools not executed if first fails

**Problem:**
```typescript
for (const call of toolCalls) {
  const result = await executeToolCall(call, config);
  results.push(result);

  if (!result.success) {
    break;  ← ❌ Stops here!
  }
}
```

**Scenario:**
1. LLM calls 3 tools: read_file, search_code, list_files
2. read_file fails (file not found)
3. search_code and list_files never execute
4. LLM only gets partial results

**Design Decision Needed:**
- Should we continue on error?
- Or make it configurable?

---

### **Issue 8: No Tool Call Count Validation** ⚠️ **MEDIUM**

**File:** `orchestrator.ts:400-409`
**Severity:** MEDIUM
**Impact:** LLM can spam tool calls

**Problem:**
```typescript
const maxCalls = config.maxToolCalls ?? 10;
const limitedCalls = toolCalls.slice(0, maxCalls);

if (toolCalls.length > maxCalls) {
  config.context.addMessage({
    role: "tool",
    content: `Warning: Too many tool calls (${toolCalls.length}). Limiting to ${maxCalls}.`,
  });
}
```

**Issues:**
1. Only warns AFTER limiting (too late)
2. No validation at parse time
3. No penalty for spamming
4. Default of 10 might be too high

**Edge case:**
LLM generates 50 tool calls in one response → system silently limits to 10 → LLM has no idea which 40 were dropped.

**Fix Required:**
- Warn LLM BEFORE they hit the limit
- Make limit more visible in prompt
- Consider lower default (e.g., 5)

---

## 🟠 Medium Priority Issues

### **Issue 9: Tool Result Truncation Not Communicated** ⚠️ **LOW-MEDIUM**

**File:** `orchestrator.ts:273-278`
**Severity:** MEDIUM
**Impact:** LLM doesn't know result was truncated

**Problem:**
```typescript
const resultStr = typeof result === "string"
  ? result
  : JSON.stringify(result, null, 2);

const truncated = config.context.truncateResult(resultStr);
// ❌ No indication if truncation happened!
```

**Scenario:**
1. Tool returns 10KB of data
2. System truncates to 2KB
3. LLM gets partial result
4. LLM doesn't know it's partial
5. LLM makes decisions on incomplete data

**Fix Required:**
Add "[TRUNCATED]" marker if result was truncated.

---

### **Issue 10: Denial Counter Not Per-Tool** ⚠️ **LOW-MEDIUM**

**File:** `orchestrator.ts:589-659`
**Severity:** MEDIUM
**Impact:** One denied tool blocks ALL tools

**Problem:**
```typescript
let consecutiveDenials = 0;

if (anyDenied) {
  consecutiveDenials++;
  if (consecutiveDenials >= maxDenials) {
    // Stop agent
  }
}
```

**Scenario:**
1. LLM tries write_file → User denies (1)
2. LLM tries shell_exec → User denies (2)
3. LLM tries write_file again → User denies (3)
4. Agent stops

But what if user wants to deny ALL write operations but allow shell operations?

**Fix Required:**
Track denials per tool OR per safety level.

---

### **Issue 11: L1 Confirmation is Global, Not Per-Args** ⚠️ **LOW**

**File:** `safety.ts:47-91`
**Severity:** LOW
**Impact:** L1 remember applies to ALL instances of tool

**Problem:**
```typescript
const l1Confirmations = new Map<string, boolean>();
// Key: tool name only, not tool name + args
```

**Scenario:**
1. User confirms `shell_exec` with `git status`
2. User says "remember this"
3. Now `shell_exec` with `rm -rf /` is also auto-approved!

**Current behavior is per-tool, should be per-command:**
```typescript
// Should be:
const l1Confirmations = new Map<string, Set<string>>();
// Key: tool name, Value: Set of approved argument hashes
```

---

### **Issue 12: No Timeout on User Input** ⚠️ **LOW**

**File:** `safety.ts:332-357`
**Severity:** LOW
**Impact:** Agent hangs forever if user doesn't respond

**Problem:**
```typescript
async function readLine(...) {
  while (true) {
    const byte = new Uint8Array(1);
    const bytesRead = await platform.terminal.stdin.read(byte);
    // ❌ No timeout!
  }
}
```

**Scenario:**
1. Agent asks for confirmation
2. User goes to lunch
3. Agent waits forever
4. No timeout, no cancellation

**Fix Required:**
Add timeout (e.g., 60s) with default to "deny".

---

## Edge Cases Not Handled

### **1. LLM Generates Nested TOOL_CALL Blocks**

```
TOOL_CALL
{
  "toolName": "write_file",
  "args": {
    "content": "TOOL_CALL\n{...}\nEND_TOOL_CALL"
  }
}
END_TOOL_CALL
```

Parser will break - thinks first END_TOOL_CALL closes outer call.

---

### **2. LLM Uses Wrong Envelope Markers**

```
TOOL_CALL_START  ← Wrong!
{"toolName": "foo", "args": {}}
TOOL_CALL_FINISH  ← Wrong!
```

Silent failure - tool never executes.

---

### **3. LLM Generates Code Block Around Envelope**

````
```
TOOL_CALL
{"toolName": "foo", "args": {}}
END_TOOL_CALL
```
````

Parser won't see TOOL_CALL because it's inside code fence.

---

### **4. Tool Returns Malicious JSON**

```typescript
// Tool returns:
return '{"__proto__": {"polluted": true}}';
```

When parsed and sent back to LLM, could pollute prototype.

---

### **5. Concurrent Tool Execution**

Current code is sequential:
```typescript
for (const call of toolCalls) {
  await executeToolCall(call, config);
}
```

What if LLM wants parallel execution?
- Read 3 files at once?
- Should be supported but isn't.

---

## Testing Gaps

### **1. No Test for Invalid JSON**

Unit tests don't cover:
- Missing closing brace
- Extra commas
- Invalid escape sequences
- Non-string keys

---

### **2. No Test for Silent Failures**

No test verifies that:
- Parse errors are reported to LLM
- Unclosed blocks are detected
- Invalid structure generates errors

---

### **3. No Test for Hallucination Prevention**

No test verifies that:
- LLM doesn't fabricate [Tool Result]
- LLM waits for actual tool result
- LLM cites tool correctly

---

### **4. No Load Test**

What happens with:
- 100 tool calls in one response?
- 10MB tool result?
- 1000 iterations in ReAct loop?

---

## Recommendations

### **Immediate (Week 4)**

1. ✅ **Fix Issue 1:** Add error reporting for JSON parse failures
2. ✅ **Fix Issue 2:** Add error reporting for validation failures
3. ✅ **Fix Issue 4:** Add anti-hallucination instructions to prompt
4. ✅ **Fix Issue 5:** Make envelope format stricter

**Estimated:** 2-3 days

---

### **Short Term (Week 5-6)**

5. ✅ **Fix Issue 3:** Detect unclosed TOOL_CALL blocks
6. ✅ **Fix Issue 6:** Add line numbers to error messages
7. ✅ **Fix Issue 9:** Add truncation markers
8. ✅ **Add Tests:** Cover all edge cases above

**Estimated:** 1 week

---

### **Medium Term (Week 7-8)**

9. ✅ **Fix Issue 7:** Make sequential/concurrent configurable
10. ✅ **Fix Issue 10:** Per-tool denial tracking
11. ✅ **Fix Issue 11:** Per-args L1 confirmation
12. ✅ **Add Validation:** Strict envelope format checker

**Estimated:** 1-2 weeks

---

### **Long Term (Month 2)**

13. ✅ **Anti-Hallucination System:** Detect fabricated tool results
14. ✅ **Tool Call Optimizer:** Merge redundant calls
15. ✅ **Parallel Execution:** Support concurrent tool calls
16. ✅ **Load Testing:** Handle high-volume scenarios

**Estimated:** 3-4 weeks

---

## Severity Definitions

**CRITICAL:** Causes production failures, data loss, or security issues
**HIGH:** Degrades reliability, causes frequent errors
**MEDIUM:** Reduces quality, causes occasional issues
**LOW:** Minor inconvenience, rare edge cases

---

## Conclusion

**Current State:**
- ✅ Good architecture and design
- ✅ Week 1-3 features work correctly
- ❌ **Fragile execution** with silent failures
- ❌ **Hallucination risk** not mitigated

**Critical Path:**
1. Fix silent error handling (Issues 1-2)
2. Add anti-hallucination instructions (Issue 4)
3. Strict envelope format (Issue 5)
4. Comprehensive testing

**Timeline:** 2-3 days for critical fixes, 4-6 weeks for all issues

**Verdict:** Core is **functional but fragile**. Critical fixes required before production use.
