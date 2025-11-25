; ============================================================================
; Template Literals Examples (v2.0) - Executable Demonstrations
; ============================================================================
; Run with: deno run -A core/cli/run.ts doc/features/12-template-literals/examples.hql

(print "=== TEMPLATE LITERALS EXAMPLES ===")
(print "")

; Plain strings
(print "1. Plain template strings:")
(print "  `hello world` =>" `hello world`)
(print "  `` =>" ``)
(print "")

; Single interpolation
(print "2. Single interpolation:")
(print "  `${10} apples` =>" `${10} apples`)
(print "  `I have ${5} apples` =>" `I have ${5} apples`)
(print "  `Total: ${42}` =>" `Total: ${42}`)
(print "")

; Multiple interpolations
(print "3. Multiple interpolations:")
(print "  `${1} + ${2} = 3` =>" `${1} + ${2} = 3`)
(print "  `${1}, ${2}, ${3}` =>" `${1}, ${2}, ${3}`)
(print "")

; Expressions in interpolations
(print "4. Arithmetic expressions:")
(print "  `Sum: ${(+ 2 3)}` =>" `Sum: ${(+ 2 3)}`)
(print "  `Product: ${(* 4 5)}` =>" `Product: ${(* 4 5)}`)
(print "")

; Variables
(print "5. Variable interpolation:")
(let name "Alice")
(print "  `Hello, ${name}!` =>" `Hello, ${name}!`)
(let x 10)
(let y 20)
(print "  `${x} + ${y} = ${(+ x y)}` =>" `${x} + ${y} = ${(+ x y)}`)
(print "")

; Function calls
(print "6. Function call interpolation:")
(fn double [n] (* n 2))
(print "  `Doubled: ${(double 5)}` =>" `Doubled: ${(double 5)}`)
(print "")

; Type coercion
(print "7. Type coercion:")
(print "  `Number: ${42}` =>" `Number: ${42}`)
(print "  `Bool: ${true}` =>" `Bool: ${true}`)
(print "  `Null: ${null}` =>" `Null: ${null}`)
(print "")

; Nested expressions
(print "8. Nested expressions:")
(print "  `Result: ${(* (+ 2 3) 4)}` =>" `Result: ${(* (+ 2 3) 4)}`)
(print "")

; Real-world patterns
(print "9. Logging pattern:")
(fn log [level message] `${level} - ${message}`)
(print "  " (log "INFO" "Application started"))
(print "  " (log "ERROR" "Connection failed"))
(print "")

; URL building
(print "10. URL construction:")
(fn buildUrl [base path params] `${base}/${path}?id=${params}`)
(print "  " (buildUrl "https://api.example.com" "users" 123))
(print "")

; User messages
(print "11. User messages:")
(fn welcomeMessage [userName taskCount] `Welcome back, ${userName}! You have ${taskCount} pending tasks.`)
(print "  " (welcomeMessage "Alice" 5))
(print "")

; Multiline templates
(print "12. Multiline templates:")
(let multiline `Line 1
Line 2
Line 3`)
(print "  Multiline:" multiline)
(print "")

(print "✅ All template literal examples completed successfully!")
