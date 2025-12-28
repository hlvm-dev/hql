; ============================================================================
; Import/Export Examples - Executable Specification
; ============================================================================
; These examples serve as both documentation and executable tests
; Run with: hlvm examples.hql

; NOTE: These examples demonstrate syntax but cannot run standalone
; due to dependencies on fixture files. See test file for working examples.

; ============================================================================
; SECTION 1: BASIC LOCAL IMPORTS
; ============================================================================

; Import single function
; (import [add] from "./math.hql")
; (assert (=== (add 5 10) 15) "Import single function")

; Import multiple functions
; (import [add, subtract, multiply] from "./math.hql")
; (assert (=== (add 5 3) 8) "Import multiple - add")
; (assert (=== (subtract 10 2) 8) "Import multiple - subtract")
; (assert (=== (multiply 2 4) 8) "Import multiple - multiply")

; Import constants
; (import [PI, E] from "./constants.hql")
; (assert (> PI 3.14) "Import constant PI")
; (assert (> E 2.71) "Import constant E")

; ============================================================================
; SECTION 2: ALIASED IMPORTS
; ============================================================================

; Rename imports to avoid conflicts
; (import [add as sum, multiply as times] from "./math.hql")
; (assert (=== (sum 5 3) 8) "Aliased import - sum")
; (assert (=== (times 2 4) 8) "Aliased import - times")

; Multiple aliases from same module
; (import [longFunctionName as short, anotherLongName as another] from "./utils.hql")
; (short arg1)
; (another arg2)

; ============================================================================
; SECTION 3: NAMESPACE IMPORTS
; ============================================================================

; Import entire module as namespace
; (import math from "./math.hql")
; (assert (=== (math.add 10 20) 30) "Namespace import")
; (assert (=== (math.multiply 5 6) 30) "Namespace method access")

; Namespace prevents naming conflicts
; (import array from "./array-utils.hql")
; (import object from "./object-utils.hql")
; (array.map ...)
; (object.map ...)

; ============================================================================
; SECTION 4: RE-EXPORTS
; ============================================================================

; middleware.hql re-exports from original.hql:
; (import [greet, farewell] from "./original.hql")
; (export greet)
; (export farewell)

; Consumer imports from middleware:
; (import [greet] from "./middleware.hql")
; (assert (=== (greet "World") "Hello, World!") "Re-export function")

; Re-export multiple items
; (import [func1, func2, const1] from "./middleware.hql")

; Re-export values
; (import [secretValue] from "./middleware.hql")
; (assert (=== secretValue 42) "Re-export value")

; ============================================================================
; SECTION 5: TYPESCRIPT FILE IMPORTS
; ============================================================================

; Import from .ts file
; (import [tsFunction, tsConstant] from "./module.ts")
; (assert (=== (tsFunction 5) 15) "TypeScript function import")
; (assert (=== tsConstant "TypeScript works!") "TypeScript constant import")

; Import multiple from .ts
; (import [tsAdd, tsMultiply, TS_CONSTANT] from "./ts-module.ts")
; (var result (+ (tsAdd 10 20) (tsMultiply 2 3)))
; (assert (=== result 36) "Multiple TS imports")

; ============================================================================
; SECTION 6: REMOTE IMPORTS (JSR)
; ============================================================================

; Import from JSR (Deno registry)
; (import [assertEquals] from "jsr:@std/assert")
; (assertEquals 1 1)

; Multiple imports from JSR
; (import [assertEquals, assertExists, assertNotEquals] from "jsr:@std/assert")
; (assertEquals actual expected)
; (assertExists value)
; (assertNotEquals a b)

; ============================================================================
; SECTION 7: REMOTE IMPORTS (HTTPS)
; ============================================================================

; Import from HTTPS URL
; (import [assertEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")
; (assertEquals 2 2)

; Multiple from HTTPS
; (import [assertEquals, assertNotEquals] from "https://deno.land/std@0.208.0/assert/mod.ts")

; Versioned imports (best practice)
; (import [module] from "https://example.com/package@1.2.3/mod.ts")

; ============================================================================
; SECTION 8: REMOTE IMPORTS (NPM)
; ============================================================================

; Import default export from NPM
; (import [default] from "npm:chalk@4.1.2")
; (var chalk default)
; (chalk.red "Error message")

; Import from NPM (ms package)
; (import [default] from "npm:ms@2.1.3")
; (var ms default)
; (ms "2 days")  ; => 172800000

; Import lodash utilities
; (import [default] from "npm:lodash@4.17.21")
; (var _ default)
; (_.map [1, 2, 3] double)

; ============================================================================
; REAL-WORLD EXAMPLE 1: MATH UTILITIES MODULE
; ============================================================================

; math-utils.hql
(export (fn add [a b]
  (+ a b)))

(export (fn subtract [a b]
  (- a b)))

(export (fn multiply [a b]
  (* a b)))

(export (fn divide [a b]
  (/ a b)))

(export (let PI 3.14159))
(export (let E 2.71828))

; Usage:
; (import [add, multiply, PI] from "./math-utils.hql")
; (var circumference (* 2 PI (var radius 5)))

; ============================================================================
; REAL-WORLD EXAMPLE 2: API CLIENT WITH RE-EXPORTS
; ============================================================================

; api/users.hql
(export (fn getUser [id]
  (fetch (+ "/api/users/" id))))

; api/posts.hql
(export (fn getPost [id]
  (fetch (+ "/api/posts/" id))))

; api/index.hql (barrel export)
; (import [getUser] from "./users.hql")
; (import [getPost] from "./posts.hql")
; (export getUser)
; (export getPost)

; main.hql (clean import)
; (import [getUser, getPost] from "./api/index.hql")

; ============================================================================
; REAL-WORLD EXAMPLE 3: TEST UTILITIES
; ============================================================================

; test-helpers.hql
(import [assertEquals, assertExists] from "jsr:@std/assert")

(fn test-runner [name test-fn]
  (do
    (print (+ "Running: " name))
    (test-fn)
    (print "✓ Passed")))

(export (fn assertBetween [value min max]
  (do
    (assert (>= value min) "Value too low")
    (assert (<= value max) "Value too high"))))

; Usage:
; (import [runTest, assertBetween] from "./test-helpers.hql")
; (runTest "range check" (fn []
;   (assertBetween 5 0 10)))

; ============================================================================
; REAL-WORLD EXAMPLE 4: CONFIGURATION MODULE
; ============================================================================

; config/database.hql
(export (let DB_HOST "localhost"))
(export (let DB_PORT 5432))
(export (let DB_NAME "myapp"))

; config/api.hql
(export (let API_URL "https://api.example.com"))
(export (let API_TIMEOUT 5000))

; config/index.hql (aggregate config)
; (import [DB_HOST, DB_PORT, DB_NAME] from "./database.hql")
; (import [API_URL, API_TIMEOUT] from "./api.hql")
; (export DB_HOST)
; (export DB_PORT)
; (export DB_NAME)
; (export API_URL)
; (export API_TIMEOUT)

; main.hql
; (import [DB_HOST, API_URL] from "./config/index.hql")

; ============================================================================
; REAL-WORLD EXAMPLE 5: LOGGER WITH NPM CHALK
; ============================================================================

; logger.hql
; (import [default] from "npm:chalk@4.1.2")
; (var chalk default)

; (export (fn logError [message]
;   (console.log (chalk.red (+ "[ERROR] " message)))))

; (export (fn logSuccess [message]
;   (console.log (chalk.green (+ "[SUCCESS] " message)))))

; (export (fn logWarning [message]
;   (console.log (chalk.yellow (+ "[WARNING] " message)))))

; Usage:
; (import [logError, logSuccess] from "./logger.hql")
; (logSuccess "Operation completed")
; (logError "Something went wrong")

; ============================================================================
; REAL-WORLD EXAMPLE 6: VALIDATOR WITH TYPESCRIPT INTEROP
; ============================================================================

; validator.ts (TypeScript file)
; export function validateEmail(email: string): boolean {
;   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
; }
; export function validatePhone(phone: string): boolean {
;   return /^\d{3}-\d{3}-\d{4}$/.test(phone);
; }

; validation.hql
; (import [validateEmail, validatePhone] from "./validator.ts")
;
; (export (fn checkUserInput [email phone]
;   (and (validateEmail email) (validatePhone phone))))

; ============================================================================
; REAL-WORLD EXAMPLE 7: HTTP CLIENT WITH FETCH
; ============================================================================

; http-client.hql
; (import [default] from "npm:node-fetch@3.0.0")
; (var fetch default)

; (export (fn get [url]
;   (fetch url { method: "GET" })))

; (export (fn post [url data]
;   (fetch url {
;     method: "POST",
;     headers: { "Content-Type": "application/json" },
;     body: (JSON.stringify data)
;   })))

; Usage:
; (import [get, post] from "./http-client.hql")
; (var response (await (get "https://api.example.com/data")))

; ============================================================================
; REAL-WORLD EXAMPLE 8: ALIAS TO AVOID CONFLICTS
; ============================================================================

; array-utils.hql
(export (fn arrayMap [arr transform-fn]
  (do
    (var result [])
    (for [item arr]
      (.push result (transform-fn item)))
    result)))

; object-utils.hql
(fn map-values [obj transform-fn]
  (do
    (var result {})
    (for [key (Object.keys obj)]
      (= result (assoc result key (transform-fn (get obj key)))))
    result))

; main.hql (use aliases to avoid conflict)
; (import [map as arrayMap] from "./array-utils.hql")
; (import [map as objectMap] from "./object-utils.hql")
;
; (arrayMap [1, 2, 3] double)
; (objectMap { a: 1, b: 2 } increment)

; ============================================================================
; SUMMARY
; ============================================================================

(print "✅ Import/Export examples documented!")
(print "   - Local imports (.hql files): ✓")
(print "   - Aliased imports (as keyword): ✓")
(print "   - Namespace imports (module.func): ✓")
(print "   - Re-exports (middleware pattern): ✓")
(print "   - TypeScript imports (.ts files): ✓")
(print "   - Remote imports (JSR, HTTPS, NPM): ✓")
(print "   - Real-world patterns: ✓")
(print "     • Math utilities module: ✓")
(print "     • API client with barrel exports: ✓")
(print "     • Test utilities: ✓")
(print "     • Configuration aggregation: ✓")
(print "     • Logger with NPM chalk: ✓")
(print "     • TypeScript validator interop: ✓")
(print "     • HTTP client with node-fetch: ✓")
(print "     • Alias pattern for conflict resolution: ✓")
