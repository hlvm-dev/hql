──────────────────────────── Part 1: Binding Model (let, var)
────────────────────────────

Overview const: Purpose: Declare immutable bindings. Semantics: • Compiles to
JavaScript’s const. • For reference types (e.g. arrays, objects), the value is
automatically deep frozen, ensuring its internal state cannot be changed. Usage:
Use const when you want the binding to remain constant throughout its scope. let:
Purpose: Declare mutable block-scoped bindings. Semantics: • Compiles to
JavaScript’s let. • Permits updates via the `=` assignment operator within its
scope. Usage: Use let when you need the binding’s value to be updated over time
within the current block. var: Purpose: Declare mutable function-scoped
bindings. Semantics: • Compiles to JavaScript’s var. • Hoisted to the containing
function scope and updated via `=`. Usage: Use var when you need hoisting or
function-wide mutation (typically for interop or legacy patterns).
Showcase Examples Global Bindings

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; ;; Global Bindings
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Immutable global binding with let: (const globalValue 10) (print "Global
immutable value:" globalValue) ;; → Compiles to: const globalValue = 10;

;; Mutable global binding with var: (var globalCounter 0) (print "Global mutable
counter (initial):" globalCounter) (= globalCounter (+ globalCounter 1))
(print "Global mutable counter (after mutation):" globalCounter) ;; → Compiles
to: let globalCounter = 0; then updated. Local Bindings

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; ;; Local Bindings: Immutable
vs. Mutable ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Using let for an immutable local binding: (const (x 10) (print "Local immutable
x:" x) ;; (= x 20) ; ERROR: Cannot mutate x because let creates an immutable
binding. )

;; Using var for a mutable local binding: (var (y 10) (print "Local mutable y
(initial):" y) (= y (+ y 10)) ; Allowed mutation. (print "Local mutable y
(after mutation):" y) ) JavaScript Interop

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; ;; JavaScript Interop:
Preventing Accidental Mutation
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Immutable array using let: ;; Compiler must gurantee pure immutability for
example, the following Javascript interop case should be transformed inernally
;; (const numbers (new Array)) → to: (const numbers (freeze (new Array))) ;; to
gurantee immutability (const numbers (new Array)) ;; (numbers.push 1) would throw
an error at runtime. (print "Immutable array for JS interop:" numbers)

;; Mutable array using var: (var mutableNumbers (new Array))
(mutableNumbers.push 1) ;; Allowed mutation. (mutableNumbers.push 2) (print
"Mutable array for JS interop:" mutableNumbers)
