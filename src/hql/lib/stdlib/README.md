# HQL Stdlib

The HQL standard library has a three-layer architecture.
**Do not directly edit `js/self-hosted.js` — it is a compiled artifact.**

```
stdlib.hql (HQL source)  ──transpile──▶  js/self-hosted.js (JS runtime)
                                              ▲
                                              │ imports
js/core.js (low-level primitives)  ◀─────  js/index.js (router)
```

| File                | Role                                           | Editable?                 |
| ------------------- | ---------------------------------------------- | ------------------------- |
| `stdlib.hql`        | HQL source definitions (~92 functions)         | **Yes** — edit here       |
| `js/self-hosted.js` | Pre-transpiled JS (the actual runtime)         | **No** — generated output |
| `js/core.js`        | Low-level primitives (first, rest, cons, …)    | Only for primitives       |
| `js/index.js`       | Routes functions from self-hosted.js vs core.js | Only to update routing    |

## Rules

- Add or modify a stdlib function → edit `stdlib.hql`, then re-transpile.
- `self-hosted.js` is generated — direct edits will diverge from the HQL source.
- `js/index.js` has a `SELF_HOSTED_FUNCTIONS` Set that controls routing —
  update it when adding new functions.
