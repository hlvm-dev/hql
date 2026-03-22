# History Navigation & Slash Commands: Quick Reference

## The Core Principle: "Inert Recall"

**History recall should be "inert" — it fills the input field but does NOT execute or trigger command detection until the user explicitly presses Enter.**

```
UP/DOWN arrow keys:  text_field = history[index]  ← Pure text, no side effects
Ctrl+R search:       text_field = selected_entry  ← Pure text, no side effects
═══════════════════════════════════════════════════════════════════════════════
ENTER key:           parse_and_route(text_field)  ← ALL logic here
                     ↓
                     Is it a slash command?
                     ↓
                     execute side effects
```

---

## How Popular Tools Implement It

### Bash/Zsh Readline
- **Navigation:** `history-search-backward` fills input buffer with text
- **Detection:** Happens when user presses Enter
- **Side effects:** Only triggered after Enter (e.g., history expansion `!`, parameter expansion)

### Fish Shell
- **Navigation:** Arrow keys populate buffer inertly
- **Detection:** On Enter, fish parses for special syntax
- **Side effects:** On submission only

### IPython REPL
- **Navigation:** Arrow keys or Ctrl+R fill buffer
- **Magic commands:** `%history`, `%recall` are recognized only on submission
- **Side effects:** `%rerun` explicitly runs past commands (not automatic)

### CIDER (Clojure)
- **Navigation:** History inserts text **without trailing newline** (UX signal!)
- **Preview:** Overlay shows selection without modifying buffer
- **Execution:** Only on explicit Enter

### Claude Code
- **Navigation:** Arrow keys, `/resume` fill input buffer
- **Command detection:** Only in `handleSubmit` function
- **Side effects:** Only after command is recognized and user approves

### GitHub Copilot CLI
- **Navigation:** `/resume` loads session history
- **Command routing:** Happens on Enter during input parsing
- **Side effects:** Slash commands execute only on submission

---

## HLVM Implementation (Claude Code REPL)

### Correct Architecture Already In Place

**1. Input.tsx - History Navigation (Lines 1382-1429)**
```typescript
const navigateHistory = useCallback((direction: number) => {
  // Fill input field with history text
  onChange(entry);           // ← Pure text change
  setCursorPos(entry.length);
}, [...]);
```
✓ Navigation does NOT trigger command detection
✓ NO side effects happen here

**2. App.tsx - Command Detection (Line 787)**
```typescript
const isAnyCommand = isPanelCommand || isCommand(code);
```
✓ Command detection only happens in handleSubmit
✓ This is called ONLY when user presses Enter
✓ NOT called during history navigation

**3. App.tsx - Submission Handler (Lines 770-854)**
```typescript
const handleSubmit = useCallback(async (code: string) => {
  const isAnyCommand = isCommand(code);  // Detect

  if (isAnyCommand) {
    recordPromptHistory(replState, code, "command");
    await handleCommand(code, exit, replState);  // Execute
  }
  // ...other routing...
}, [...]);
```
✓ Execution only happens here
✓ Only called on Enter

**4. prompt-history.ts - Source-Aware Recording**
```typescript
export function recordPromptHistory(
  replState: Pick<ReplState, "addHistory">,
  input: string,
  source: PromptHistorySource,
): void {
  if (!shouldRecordPromptHistory(source)) {
    return;  // Skip local eval history
  }
  replState.addHistory(input);
}
```
✓ Prevents noise in history (local evals don't get stored)
✓ Only records user-intended commands

---

## Why This Pattern Is Universal

### 1. **Predictability**
Users expect: "Arrow key = review", "Enter = execute"
If history navigation triggered execution, users would be surprised.

### 2. **Safety**
Prevents accidental execution of dangerous commands:
- `rm -rf /` (shell)
- API deletion commands
- Database migrations

### 3. **Editability**
Users must be able to modify recalled commands:
- Change parameters
- Fix typos
- Adapt to current context

### 4. **Consistency**
Every shell and REPL follows this pattern.
Users have trained expectations.

---

## Implementation Checklist

### For History Navigation Features
- [ ] History is stored as plain strings (no metadata about type)
- [ ] Navigation (arrows, Ctrl+R) only calls `onChange(text)`
- [ ] Navigation does NOT call any parsing/detection logic
- [ ] Navigation does NOT trigger any event handlers
- [ ] Navigation does NOT execute any side effects

### For Command Routing
- [ ] Command detection happens in a handler that's called ONLY on submission
- [ ] Detection is text-based (starts with `/`, matches function name, etc.)
- [ ] Submission handler runs AFTER user presses Enter
- [ ] Side effect execution is separate from detection

### For History Recording
- [ ] Record history AFTER submission succeeds (not before)
- [ ] Skip recording for local evaluations/noise (use source enum)
- [ ] Include both successful and failed submissions (for recovery)

---

## Edge Cases & Solutions

### Edge Case 1: Multiline Input
**Problem:** User has 3 lines of code, presses Up. Should it navigate history or move cursor?

**Solution:** Check if cursor is at the top of the multiline first. Only navigate history if cursor can't move within the current input.

**HLVM Status:** ✓ Handled correctly in Input.tsx (lines 2604-2614)

### Edge Case 2: History Search Mode
**Problem:** While in Ctrl+R search mode, what happens if user presses arrow keys?

**Solution:** Arrow keys navigate search results, not history. Only Enter confirms selection.

**HLVM Status:** ✓ Handled correctly in Input.tsx (lines 1882-1959)

### Edge Case 3: Special Characters in History
**Problem:** User recalls `/model` but wants to edit it to `/model ollama/llama2`.

**Solution:** Just let user edit the text. Command detection is text-based and happens on Enter, so it works naturally.

**HLVM Status:** ✓ Works correctly because detection is in handleSubmit

---

## Key Code Locations

| Feature | File | Lines | Status |
|---------|------|-------|--------|
| History navigation | Input.tsx | 1382-1429 | ✓ Correct |
| Arrow key handlers | Input.tsx | 2580-2668 | ✓ Correct |
| History search mode | Input.tsx | 1882-1959 | ✓ Correct |
| Command detection | App.tsx | 787 | ✓ Correct |
| Submission handler | App.tsx | 770-854 | ✓ Correct |
| History recording | App.tsx | 843, 866, 893 | ✓ Correct |
| Source-aware skip | prompt-history.ts | 9-13 | ✓ Correct |

---

## Conclusion

HLVM's history navigation implementation **already correctly follows the industry-standard "inert recall" pattern**. History navigation is pure text-based, command detection is deferred to submission time, and side effects only happen after user approval.

This is the right architecture and matches what Bash, Zsh, Fish, IPython, CIDER, Claude Code, and Copilot CLI all do.

**No architectural changes are needed — the current design is sound.**
