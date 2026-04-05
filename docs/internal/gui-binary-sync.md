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

## Optional Convenience Hook

To enable the tracked post-commit sync hook in a clone:

```bash
git config core.hooksPath .githooks
```

That activates `.githooks/post-commit`, which syncs the SSOT binary into a
sibling `../HLVM` checkout when it exists.

The hook is convenience only. The Xcode build phase remains the correctness
path for the GUI app.
