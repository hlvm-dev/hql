# Lazy Evaluation

**Source:** `src/hql/lib/stdlib/js/internal/seq-protocol.js`, `src/hql/lib/stdlib/js/core.js`, `src/hql/lib/stdlib/stdlib.hql`

HQL implements Clojure-inspired lazy sequences built on a Symbol-based protocol system. Lazy sequences defer computation until values are needed, enable infinite data structures, and provide memory-efficient processing.

## Summary

- **SEQ Protocol**: Symbol-based protocol (`hql.seq`) with `first()`, `rest()`, `seq()` methods
- **lazy-seq**: Creates lazy sequences from thunks, memoized and trampolined
- **Cons cells**: Immutable pairs via `(cons head tail)`
- **seq function**: Converts collections to lazy sequences with nil-punning
- **delay/force/realized**: Deferred computation primitives
- **Infinite sequences**: `range`, `repeat`, `cycle`, `iterate`
- **Chunked sequences**: ArrayChunk/ChunkBuffer/ChunkedCons for batch optimization

## Quick Examples

```lisp
;; Infinite lazy sequence
(take 5 (range))           ;; => (0 1 2 3 4)

;; Lazy transformations (nothing computed until consumed)
(take 3 (filter isOdd (range)))  ;; => (1 3 5)

;; Infinite fibonacci
(fn fib-seq [a b]
  (lazy-seq (cons a (fib-seq b (+ a b)))))
(take 10 (fib-seq 0 1))  ;; => (0 1 1 2 3 5 8 13 21 34)

;; Cons cells
(cons 1 (cons 2 (cons 3 null)))  ;; => (1 2 3)

;; Nil-punning
(seq [])    ;; => null
(seq [1])   ;; => ArraySeq(1)

;; Delay/Force
(let d (delay (expensive-computation)))
(force d)      ;; evaluates and caches
(realized d)   ;; => true
```

## Core Types

| Type | Description | Protocols |
|------|-------------|-----------|
| EMPTY | Singleton empty sequence | SEQ, COUNTED, INDEXED |
| Cons | Immutable (first, rest) pair | SEQ |
| LazySeq | Memoized lazy thunk | SEQ |
| ArraySeq | View over array | SEQ, COUNTED, INDEXED |
| ChunkedCons | Chunked lazy sequence | SEQ |

## See Also

- [spec.md](./spec.md) - Technical specification
- [examples.hql](./examples.hql) - More examples
