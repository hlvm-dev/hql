;; @hql/fs - File system utilities for HQL
;; Version: 0.1.0
;;
;; Usage:
;;   (import [read, write, exists?] from "@hql/fs")
;;   (await (read "./file.txt"))
;;   (await (write "./file.txt" "content"))

(fn read [path]
  "Read file contents as string.

  Args:
    path - File path to read

  Returns:
    Promise resolving to file contents

  Example:
    (await (read \"./file.txt\"))"
  (js/Deno.readTextFile path))

(fn write [path content]
  "Write string content to file.

  Args:
    path - File path to write
    content - String content to write

  Returns:
    Promise resolving when complete

  Example:
    (await (write \"./file.txt\" \"hello\"))"
  (js/Deno.writeTextFile path content))

(fn exists? [path]
  "Check if file or directory exists.

  Args:
    path - Path to check

  Returns:
    Promise resolving to boolean

  Example:
    (await (exists? \"./file.txt\"))"
  (.then
    (.stat js/Deno path)
    (fn [_] true)
    (fn [_] false)))

(fn remove [path]
  "Remove (delete) file or directory.

  Args:
    path - Path to remove

  Returns:
    Promise resolving when complete

  Example:
    (await (remove \"./file.txt\"))"
  (js/Deno.remove path))

;; Export all fs utilities
(export [read, write, exists?, remove])
