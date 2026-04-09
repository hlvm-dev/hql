# GUI Binary Sync

`~/dev/hql` is the only source of truth for building the bundled `hlvm` binary.

## SSOT Flow

```text
~/dev/hql
  -> make build / make build-fast
  -> produces ./hlvm

~/dev/HLVM
  -> Xcode shell phase calls scripts/sync-gui-binary.sh
  -> copies ~/dev/hql/hlvm into HLVM/Resources/hlvm
  -> app bundle ships that exact binary
```

The GUI repo must not compile a second, divergent `hlvm`.

## Binary-First Ownership

The bundled binary is the agent SSOT. GUI surfaces stay thin unless a behavior
is inherently native-framework or per-keystroke UI work.

| Logic area                                                | Owner                       | Notes                                                        |
| --------------------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| Agent reasoning, prompts, permissions, memory, task state | Binary                      | Core product semantics live in `hlvm`                        |
| Tool meaning and action semantics                         | Binary                      | Cross-surface behavior should stay identical                 |
| Module/function metadata and invocation semantics         | Binary                      | Launchpad/Hotbar/UI surfaces should consume the same meaning |
| Instant app/file fuzzy lookup                             | GUI                         | Native-speed Spotlight-style interaction                     |
| Spotlight suggestions/autocomplete                        | GUI, shallow only           | Fast UI sugar, not agent policy                              |
| Spotlight/Chat show-hide-focus                            | GUI                         | Native window management                                     |
| Quick Look / thumbnails / drag-drop / rich clipboard      | GUI                         | Native frameworks and presentation                           |
| Trash / reveal / local cleanup semantics                  | Binary                      | Agent work with stable semantics across CLI and GUI          |
| STT/TTS / media / native framework hooks                  | GUI via narrow host channel | Native capability edge only                                  |

## Migration Rule

When a behavior exists in both repos, classify it before moving code:

1. If it is semantic and should behave the same in CLI, GUI, and future shells,
   move it into the binary.
2. If it is per-keystroke, rendering-heavy, or tied to native frameworks, keep
   it in the GUI.
3. Avoid routing every Spotlight keystroke through `/api/chat`; instant lookup
   remains GUI-owned even when the binary is the product SSOT.

## Optional Convenience Hook

To enable the tracked post-commit sync hook in a clone:

```bash
git config core.hooksPath .githooks
```

That activates `.githooks/post-commit`, which syncs the SSOT binary into a
sibling `../HLVM` checkout when it exists.

The hook is convenience only. The Xcode build phase remains the correctness path
for the GUI app.
