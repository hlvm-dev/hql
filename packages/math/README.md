# @hql/math

Math utilities for HQL.

> **Note**: This package is embedded in HQL. No installation required - just import and use.

## Usage

**In HQL:**
```hql
(import [abs, floor, ceil, round, min, max] from "@hql/math")

(abs -5)           ;; => 5
(floor 3.7)        ;; => 3
(ceil 3.2)         ;; => 4
(round 3.7)        ;; => 4
(min 1 5 3 9 2)    ;; => 1
(max 1 5 3 9 2)    ;; => 9
```

## API

### `abs`
Return absolute value of a number.

```hql
(abs -42)   ;; => 42
(abs 3.14)  ;; => 3.14
```

### `floor`
Round number down to nearest integer.

```hql
(floor 3.7)   ;; => 3
(floor -2.3)  ;; => -3
```

### `ceil`
Round number up to nearest integer.

```hql
(ceil 3.2)   ;; => 4
(ceil -2.7)  ;; => -2
```

### `round`
Round number to nearest integer.

```hql
(round 3.7)  ;; => 4
(round 3.2)  ;; => 3
(round 3.5)  ;; => 4
```

### `min`
Return minimum value from arguments.

```hql
(min 5 2 8 1)      ;; => 1
(min -3 0 5)       ;; => -3
```

### `max`
Return maximum value from arguments.

```hql
(max 5 2 8 1)      ;; => 8
(max -3 0 5)       ;; => 5
```

## License

MIT

## Version

0.1.0
