;; @hql/date - Date utilities for HQL
;; Version: 0.1.0
;;
;; Usage:
;;   (import [now, format] from "@hql/date")
;;   (now)                    ;; => 1699564800000
;;   (format (now))           ;; => "2024-11-09T12:00:00.000Z"

(fn now []
  "Get current timestamp in milliseconds.

  Returns:
    Current timestamp as number

  Example:
    (now)  ;; => 1699564800000"
  (.getTime (new js/Date)))

(fn parse [date-str]
  "Parse ISO date string to timestamp.

  Args:
    date-str - ISO 8601 date string

  Returns:
    Timestamp in milliseconds

  Example:
    (parse \"2024-01-01T00:00:00.000Z\")  ;; => 1704067200000"
  (.getTime (new js/Date date-str)))

(fn format [timestamp]
  "Format timestamp to ISO string.

  Args:
    timestamp - Milliseconds since epoch

  Returns:
    ISO 8601 formatted string

  Example:
    (format 1704067200000)  ;; => \"2024-01-01T00:00:00.000Z\""
  (.toISOString (new js/Date timestamp)))

(fn add [timestamp milliseconds]
  "Add milliseconds to timestamp.

  Args:
    timestamp - Base timestamp
    milliseconds - Amount to add

  Returns:
    New timestamp

  Example:
    (add 1704067200000 3600000)  ;; Add 1 hour"
  (+ timestamp milliseconds))

(fn diff [timestamp1 timestamp2]
  "Get difference between two timestamps.

  Args:
    timestamp1 - First timestamp
    timestamp2 - Second timestamp

  Returns:
    Difference in milliseconds (timestamp1 - timestamp2)

  Example:
    (diff 1704070800000 1704067200000)  ;; => 3600000 (1 hour)"
  (- timestamp1 timestamp2))

;; Export all date utilities
(export [now, parse, format, add, diff])
