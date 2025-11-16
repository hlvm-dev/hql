──────────────────────────── Part 1: Binding Model (let, var)
────────────────────────────

Overview let: Purpose: Declare immutable bindings. Semantics: • Compiles to
JavaScript’s const. • For reference types (e.g. arrays, objects), the value is
automatically frozen (using an internal helper such as freeze), ensuring its
internal state cannot be changed. Usage: Use let when you want the binding to
remain constant throughout its scope. var: Purpose: Declare mutable bindings.
Semantics: • Compiles to JavaScript’s let. • Permits updates via set! within its
scope. Usage: Use var when you need the binding’s value to be updated over time.
Showcase Examples Global Bindings

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; ;; Global Bindings
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Immutable global binding with let: (let globalValue 10) (print "Global
immutable value:" globalValue) ;; → Compiles to: const globalValue = 10;

;; Mutable global binding with var: (var globalCounter 0) (print "Global mutable
counter (initial):" globalCounter) (set! globalCounter (+ globalCounter 1))
(print "Global mutable counter (after mutation):" globalCounter) ;; → Compiles
to: let globalCounter = 0; then updated. Local Bindings

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; ;; Local Bindings: Immutable
vs. Mutable ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Using let for an immutable local binding: (let (x 10) (print "Local immutable
x:" x) ;; (set! x 20) ; ERROR: Cannot mutate x because let creates an immutable
binding. )

;; Using var for a mutable local binding: (var (y 10) (print "Local mutable y
(initial):" y) (set! y (+ y 10)) ; Allowed mutation. (print "Local mutable y
(after mutation):" y) ) JavaScript Interop

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;; ;; JavaScript Interop:
Preventing Accidental Mutation
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; Immutable array using let: ;; Compiler must gurantee pure immutability for
example, the following Javascript interop case should be transformed inernally
;; (let numbers (new Array)) → to: (let numbers (freeze (new Array))) ;; to
gurantee immutability (let numbers (new Array)) ;; (numbers.push 1) would throw
an error at runtime. (print "Immutable array for JS interop:" numbers)

;; Mutable array using var: (var mutableNumbers (new Array))
(mutableNumbers.push 1) ;; Allowed mutation. (mutableNumbers.push 2) (print
"Mutable array for JS interop:" mutableNumbers)
