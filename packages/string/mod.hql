;; @hql/string - String utilities for HQL
;; Version: 0.1.0
;;
;; Usage:
;;   (import [split, join, trim] from "@hql/string")
;;   (split "hello,world" ",")  ;; => ["hello" "world"]

(fn split [str sep]
  "Split string by separator.

  Args:
    str - String to split
    sep - Separator string

  Returns:
    Array of string parts

  Example:
    (split \"hello,world\" \",\")  ;; => [\"hello\" \"world\"]"
  (.split str sep))

(fn join [arr sep]
  "Join array elements into string.

  Args:
    arr - Array to join
    sep - Separator string

  Returns:
    Joined string

  Example:
    (join [\"a\" \"b\" \"c\"] \"-\")  ;; => \"a-b-c\""
  (.join arr sep))

(fn trim [str]
  "Remove whitespace from both ends of string.

  Args:
    str - String to trim

  Returns:
    Trimmed string

  Example:
    (trim \"  hello  \")  ;; => \"hello\""
  (.trim str))

(fn upper-case [str]
  "Convert string to uppercase.

  Args:
    str - String to convert

  Returns:
    Uppercase string

  Example:
    (upper-case \"hello\")  ;; => \"HELLO\""
  (.toUpperCase str))

(fn lower-case [str]
  "Convert string to lowercase.

  Args:
    str - String to convert

  Returns:
    Lowercase string

  Example:
    (lower-case \"HELLO\")  ;; => \"hello\""
  (.toLowerCase str))

(fn starts-with? [str prefix]
  "Check if string starts with prefix.

  Args:
    str - String to check
    prefix - Prefix to look for

  Returns:
    Boolean - true if str starts with prefix

  Example:
    (starts-with? \"hello\" \"he\")  ;; => true
    (starts-with? \"hello\" \"lo\")  ;; => false"
  (.startsWith str prefix))

(fn ends-with? [str suffix]
  "Check if string ends with suffix.

  Args:
    str - String to check
    suffix - Suffix to look for

  Returns:
    Boolean - true if str ends with suffix

  Example:
    (ends-with? \"hello\" \"lo\")  ;; => true
    (ends-with? \"hello\" \"he\")  ;; => false"
  (.endsWith str suffix))

(fn replace [str search replacement]
  "Replace first occurrence of search string.

  Args:
    str - String to search in
    search - String to find
    replacement - String to replace with

  Returns:
    String with first occurrence replaced

  Example:
    (replace \"hello world\" \"world\" \"there\")  ;; => \"hello there\""
  (.replace str search replacement))

;; Export all string utilities
(export [split, join, trim, upper-case, lower-case, starts-with?, ends-with?, replace])
