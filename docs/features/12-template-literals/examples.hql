; ============================================================================
; Template Literals Examples (v2.0) - Executable Demonstrations
; ============================================================================
; Run with: deno run -A src/hlvm/cli/run.ts docs/features/12-template-literals/examples.hql

(import [assert] from "@hlvm/assert")

(print "=== TEMPLATE LITERALS EXAMPLES ===")
(print "")

; Plain strings
(print "1. Plain template strings:")
(let plain-hello `hello world`)
(let plain-empty ``)
(assert (=== plain-hello "hello world") "plain template")
(assert (=== plain-empty "") "empty template")
(print "  `hello world` =>" plain-hello)
(print "  `` =>" plain-empty)
(print "")

; Single interpolation
(print "2. Single interpolation:")
(let interp-apples `${10} apples`)
(let interp-have `I have ${5} apples`)
(let interp-total `Total: ${42}`)
(assert (=== interp-apples "10 apples") "single interpolation 1")
(assert (=== interp-have "I have 5 apples") "single interpolation 2")
(assert (=== interp-total "Total: 42") "single interpolation 3")
(print "  `${10} apples` =>" interp-apples)
(print "  `I have ${5} apples` =>" interp-have)
(print "  `Total: ${42}` =>" interp-total)
(print "")

; Multiple interpolations
(print "3. Multiple interpolations:")
(let interp-sum `${1} + ${2} = 3`)
(let interp-list `${1}, ${2}, ${3}`)
(assert (=== interp-sum "1 + 2 = 3") "multiple interpolation sum")
(assert (=== interp-list "1, 2, 3") "multiple interpolation list")
(print "  `${1} + ${2} = 3` =>" interp-sum)
(print "  `${1}, ${2}, ${3}` =>" interp-list)
(print "")

; Expressions in interpolations
(print "4. Arithmetic expressions:")
(let expr-sum `Sum: ${(+ 2 3)}`)
(let expr-product `Product: ${(* 4 5)}`)
(assert (=== expr-sum "Sum: 5") "expression interpolation sum")
(assert (=== expr-product "Product: 20") "expression interpolation product")
(print "  `Sum: ${(+ 2 3)}` =>" expr-sum)
(print "  `Product: ${(* 4 5)}` =>" expr-product)
(print "")

; Variables
(print "5. Variable interpolation:")
(let name "Alice")
(let hello-name `Hello, ${name}!`)
(assert (=== hello-name "Hello, Alice!") "variable interpolation name")
(print "  `Hello, ${name}!` =>" hello-name)
(let x 10)
(let y 20)
(let interp-vars `${x} + ${y} = ${(+ x y)}`)
(assert (=== interp-vars "10 + 20 = 30") "variable interpolation math")
(print "  `${x} + ${y} = ${(+ x y)}` =>" interp-vars)
(print "")

; Function calls
(print "6. Function call interpolation:")
(fn double [n] (* n 2))
(let interp-double `Doubled: ${(double 5)}`)
(assert (=== interp-double "Doubled: 10") "function interpolation")
(print "  `Doubled: ${(double 5)}` =>" interp-double)
(print "")

; Type coercion
(print "7. Type coercion:")
(let interp-number `Number: ${42}`)
(let interp-bool `Bool: ${true}`)
(let interp-null `Null: ${null}`)
(assert (=== interp-number "Number: 42") "type coercion number")
(assert (=== interp-bool "Bool: true") "type coercion bool")
(assert (=== interp-null "Null: null") "type coercion null")
(print "  `Number: ${42}` =>" interp-number)
(print "  `Bool: ${true}` =>" interp-bool)
(print "  `Null: ${null}` =>" interp-null)
(print "")

; Nested expressions
(print "8. Nested expressions:")
(let interp-nested `Result: ${(* (+ 2 3) 4)}`)
(assert (=== interp-nested "Result: 20") "nested interpolation")
(print "  `Result: ${(* (+ 2 3) 4)}` =>" interp-nested)
(print "")

; Real-world patterns
(print "9. Logging pattern:")
(fn log [level message] `${level} - ${message}`)
(let log-info (log "INFO" "Application started"))
(let log-error (log "ERROR" "Connection failed"))
(assert (=== log-info "INFO - Application started") "log info")
(assert (=== log-error "ERROR - Connection failed") "log error")
(print "  " log-info)
(print "  " log-error)
(print "")

; URL building
(print "10. URL construction:")
(fn buildUrl [base path params] `${base}/${path}?id=${params}`)
(let url (buildUrl "https://api.example.com" "users" 123))
(assert (=== url "https://api.example.com/users?id=123") "url build")
(print "  " url)
(print "")

; User messages
(print "11. User messages:")
(fn welcomeMessage [userName taskCount] `Welcome back, ${userName}! You have ${taskCount} pending tasks.`)
(let welcome (welcomeMessage "Alice" 5))
(assert (=== welcome "Welcome back, Alice! You have 5 pending tasks.") "welcome message")
(print "  " welcome)
(print "")

; Multiline templates
(print "12. Multiline templates:")
(let multiline `Line 1
Line 2
Line 3`)
(assert (=== multiline "Line 1\nLine 2\nLine 3") "multiline template")
(print "  Multiline:" multiline)
(print "")

(print "✅ All template literal examples completed successfully!")
