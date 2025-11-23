# @hql/date

Date utilities for HQL.

> **Note**: This package is embedded in HQL. No installation required - just import and use.

## Usage

**In HQL:**
```hql
(import [now, parse, format, add, diff] from "@hql/date")

(var timestamp (now))              ;; Get current time
(format timestamp)                 ;; => "2024-11-09T12:00:00.000Z"
(parse "2024-01-01T00:00:00.000Z") ;; => 1704067200000
(add timestamp 3600000)            ;; Add 1 hour
(diff timestamp1 timestamp2)       ;; Difference in ms
```

## API

### `now`
Get current timestamp in milliseconds since epoch.

```hql
(var current-time (now))
;; => 1699564800000
```

### `parse`
Parse ISO 8601 date string to timestamp.

```hql
(parse "2024-01-01T00:00:00.000Z")
;; => 1704067200000

(parse "2024-12-25T10:30:00.000Z")
;; => 1735122600000
```

### `format`
Format timestamp to ISO 8601 string.

```hql
(format 1704067200000)
;; => "2024-01-01T00:00:00.000Z"

(format (now))
;; => "2024-11-09T12:34:56.789Z"
```

### `add`
Add milliseconds to a timestamp.

```hql
;; Add 1 hour (3600000 ms)
(add 1704067200000 3600000)
;; => 1704070800000

;; Add 1 day (86400000 ms)
(add (now) 86400000)
```

### `diff`
Calculate difference between two timestamps.

```hql
;; Difference in milliseconds
(diff 1704070800000 1704067200000)
;; => 3600000 (1 hour)

;; Check time elapsed
(var start (now))
;; ... do some work ...
(var end (now))
(var elapsed (diff end start))
```

## Common Time Values

```hql
;; Milliseconds in common durations
(var SECOND 1000)
(var MINUTE 60000)
(var HOUR 3600000)
(var DAY 86400000)
(var WEEK 604800000)
```

## License

MIT

## Version

0.1.0
