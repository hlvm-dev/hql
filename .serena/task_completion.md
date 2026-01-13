# REPL Fixes and Improvements

I have addressed two issues in the REPL CLI.

## 1. AI Model Indicator (Footer)
- **Issue**: The AI model name was not visible or reliably updating in the footer.
- **Fix**:
    - Modified `src/cli/repl-ink/components/FooterHint.tsx`.
    - Added `setInterval` polling (2000ms) to ensure the model name is fetched even if initialization is delayed.
    - Added `flexGrow={1}` to the container to ensure `justifyContent="space-between"` correctly positions the indicator on the right.

## 2. Background Tasks Overlay
- **Issue**: The Background Tasks overlay was difficult to access ("BG is not working now"), likely due to a missing shortcut.
- **Fix**:
    - Modified `src/cli/repl-ink/components/App.tsx`.
    - Added `Ctrl+B` handler to `useInput` to toggle the `tasks-overlay`.
    - Implemented debouncing (150ms) to prevent rapid toggles.

## Verification
- **Static Analysis**: Verified via `deno check`.
- **Code Review**: Confirmed imports, logic, and side-effects (e.g., `Deno.stdout` writing) are correct.
