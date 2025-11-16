# @hql/string

String utilities for HQL.

> **Note**: This package is embedded in HQL. No installation required - just import and use.

## Usage

**In HQL:**
```hql
(import [split, join, trim, starts-with?, ends-with?, replace] from "@hql/string")

(split "hello,world" ",")          ;; => ["hello" "world"]
(join ["a" "b" "c"] "-")           ;; => "a-b-c"
(trim "  hello  ")                 ;; => "hello"
(upper-case "hello")               ;; => "HELLO"
(lower-case "WORLD")               ;; => "world"
(starts-with? "hello" "he")        ;; => true
(ends-with? "hello" "lo")          ;; => true
(replace "hello world" "world" "there")  ;; => "hello there"
```

## API

### `split`
Split string by separator.

```hql
(split "a,b,c" ",")  ;; => ["a" "b" "c"]
```

### `join`
Join array elements into string.

```hql
(join ["x" "y" "z"] "-")  ;; => "x-y-z"
```

### `trim`
Remove whitespace from both ends of string.

```hql
(trim "  hello  ")  ;; => "hello"
```

### `upper-case`
Convert string to uppercase.

```hql
(upper-case "hello")  ;; => "HELLO"
```

### `lower-case`
Convert string to lowercase.

```hql
(lower-case "WORLD")  ;; => "world"
```

### `starts-with?`
Check if string starts with prefix.

```hql
(starts-with? "hello world" "hello")  ;; => true
(starts-with? "hello world" "world")  ;; => false
```

### `ends-with?`
Check if string ends with suffix.

```hql
(ends-with? "hello world" "world")  ;; => true
(ends-with? "hello world" "hello")  ;; => false
```

### `replace`
Replace first occurrence of search string with replacement.

```hql
(replace "hello world" "world" "there")  ;; => "hello there"
(replace "foo bar foo" "foo" "baz")      ;; => "baz bar foo"
```

## License

MIT

## Version

0.1.0
