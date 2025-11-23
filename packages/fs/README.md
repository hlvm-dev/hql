# @hql/fs

File system utilities for HQL.

> **Note**: This package is embedded in HQL. No installation required - just import and use.
>
> **Requires**: `--allow-read` and `--allow-write` permissions when running HQL.

## Usage

**In HQL:**
```hql
(import [read, write, exists?, remove] from "@hql/fs")

;; Read file
(var content (await (read "./file.txt")))

;; Write file
(await (write "./output.txt" "hello world"))

;; Check if exists
(var file-exists (await (exists? "./file.txt")))

;; Remove file
(await (remove "./temp.txt"))
```

## API

### `read`
Read file contents as a string.

```hql
(var content (await (read "./file.txt")))
(console.log content)
```

### `write`
Write string content to a file.

```hql
;; Write new content
(await (write "./output.txt" "Hello, HQL!"))

;; Overwrite existing file
(await (write "./data.json" "{\"key\": \"value\"}"))
```

### `exists?`
Check if a file or directory exists.

```hql
(var file-exists (await (exists? "./file.txt")))
(if file-exists
  (console.log "File exists")
  (console.log "File not found"))
```

### `remove`
Remove (delete) a file or directory.

```hql
;; Remove a file
(await (remove "./temp.txt"))

;; Note: Use with caution - deletion is permanent!
```

## Examples

### Copy file contents
```hql
(import [read, write] from "@hql/fs")

(var content (await (read "./source.txt")))
(await (write "./destination.txt" content))
```

### Conditional write
```hql
(import [exists?, write] from "@hql/fs")

(var file-exists (await (exists? "./config.json")))
(if (not file-exists)
  (await (write "./config.json" "{}")))
```

### Read, process, write
```hql
(import [read, write] from "@hql/fs")
(import [upper-case] from "@hql/string")

(var content (await (read "./input.txt")))
(var uppercase-content (upper-case content))
(await (write "./output.txt" uppercase-content))
```

## License

MIT

## Version

0.1.0
