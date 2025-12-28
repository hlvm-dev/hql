──────────────────────────── Part 1: Binding Model (let, var, const)
────────────────────────────

Overview

HQL bindings have the same semantics as JavaScript:

let: Purpose: Declare block-scoped mutable bindings.
Semantics: • Compiles to JavaScript's let. • Permits updates via = within its scope.
Usage: Use let for local variables that may need reassignment.

var: Purpose: Declare function-scoped mutable bindings.
Semantics: • Compiles to JavaScript's var. • Hoisted to function scope.
Usage: Use var when function-scoped hoisting is desired (rare in modern code).

const: Purpose: Declare block-scoped immutable bindings.
Semantics: • Compiles to JavaScript's const. • For reference types (arrays, objects),
the value is automatically frozen (using Object.freeze), ensuring its internal state
cannot be changed.
Usage: Use const for values that should never be reassigned or mutated.

Showcase Examples

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Global Bindings
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Mutable binding with let:
(let x 10)
(= x 20)  ; Reassignment allowed
(print "x after reassignment:" x)
;; → Compiles to: let x = 10; x = 20;

;; Function-scoped binding with var:
(var counter 0)
(= counter (+ counter 1))
(print "counter after increment:" counter)
;; → Compiles to: var counter = 0; counter = counter + 1;

;; Immutable binding with const:
(const PI 3.14159)
;; (= PI 3.0)  ; ERROR: Cannot reassign const
(print "PI:" PI)
;; → Compiles to: const PI = Object.freeze(3.14159);

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Local Bindings with Body
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Using let for mutable local binding:
(let (x 10)
  (= x 20)  ; Allowed - let is mutable
  (print "x:" x))

;; Using const for immutable local binding:
(const (PI 3.14159)
  ;; (= PI 3.0)  ; ERROR: Cannot mutate const
  (print "PI:" PI))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Reference Types
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Mutable array using let:
(let numbers [1, 2, 3])
(numbers.push 4)  ; Allowed - let arrays are mutable
(print "numbers:" numbers)

;; Immutable array using const:
(const frozen [1, 2, 3])
;; (frozen.push 4)  ; ERROR: Cannot modify frozen array
(print "frozen:" frozen)

;; Mutable object using let:
(let person {"name": "Alice"})
(= person.name "Bob")  ; Allowed
(print "person:" person)

;; Immutable object using const:
(const config {"host": "localhost"})
;; (= config.host "127.0.0.1")  ; ERROR: Cannot modify frozen object
(print "config:" config)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Compilation Table
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

| HQL                | JavaScript                    |
|--------------------|-------------------------------|
| (let x 10)         | let x = 10;                   |
| (var x 10)         | var x = 10;                   |
| (const x 10)       | const x = Object.freeze(10);  |
| (= x 20)           | x = 20;                       |
