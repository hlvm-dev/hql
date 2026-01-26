;; HQL Enum Usage Patterns
;; This document demonstrates idiomatic ways to work with enums in HQL

(import [assert] from "@hlvm/assert")

;; --------------------------------------
;; 1. Simple Enums - no associated values
;; --------------------------------------
(enum Direction
  (case north)
  (case south)
  (case east)
  (case west)
)

;; Simple assignment
(var heading Direction.north)
(assert (=== heading Direction.north) "enum case assignment")

;; Value equality
(if (=== heading Direction.west)
  (print "Heading west!")
  (print "Not heading west"))

;; Pattern matching with cond
(let headingLabel
  (cond
    ((=== heading Direction.north) (do (print "Going north") "Going north"))
    ((=== heading Direction.south) (do (print "Going south") "Going south"))
    ((=== heading Direction.east) (do (print "Going east") "Going east"))
    ((=== heading Direction.west) (do (print "Going west") "Going west"))
  ))
(assert (=== headingLabel "Going north") "cond on enum")

;; ------------------------------
;; 2. Enums with Raw Values
;; ------------------------------
(enum HttpStatus
  (case ok 200)
  (case created 201)
  (case badRequest 400)
  (case notFound 404)
  (case serverError 500)
)

;; Using raw values for comparison
(let statusCode HttpStatus.notFound)
(assert (=== statusCode 404) "enum raw value")

;; Numeric comparisons work with raw values
(if (>= statusCode 400)
  (print "Error status code")
  (print "Success status code"))
(assert (>= statusCode 400) "enum raw value comparison")

;; ------------------------------
;; HQL Enum Implementation with Associated Values
;; ------------------------------
(enum Payment
  (case cash amount)
  (case creditCard number expiry cvv)
  (case check accountNumber routingNumber)
)

;; Creating instances with associated values
(let payment1 (Payment.cash 100))
(let payment2 (Payment.creditCard
  "4111-1111-1111-1111"
  "12/25"
  "123"))
(assert (js-call payment1 "is" "cash") "associated value is cash")
(assert (js-call payment2 "is" "creditCard") "associated value is creditCard")
(let payment1Amount (get (get payment1 "values") "amount"))
(assert (=== payment1Amount 100) "cash amount")
(let payment2Values (get payment2 "values"))
(assert (=== (get payment2Values "number") "4111-1111-1111-1111") "card number")
(assert (=== (get payment2Values "expiry") "12/25") "card expiry")
(assert (=== (get payment2Values "cvv") "123") "card cvv")

;; Using type testing
(if (js-call payment1 "is" "cash")
  (print "Cash payment of " (get (get payment1 "values") "amount"))
  (print "Not a cash payment"))

;; Processing payment with type checking
(fn processPayment [payment]
  ;; First, check the payment type
  (if (js-call payment "is" "cash")
    ;; Handle cash payment
    (do
      (let amount (get (get payment "values") "amount"))
      (print "Processing cash payment of $" amount))

    ;; Handle other payment types
    (if (js-call payment "is" "creditCard")
      (do
        (let values (get payment "values"))
        (let cardNum (get values "number"))
        (let expiry (get values "expiry"))
        (print "Processing credit card " cardNum " expiring " expiry))

      ;; Check payment type
      (if (js-call payment "is" "check")
        (do
          (let values (get payment "values"))
          (print "Processing check from account " (get values "accountNumber")))

        ;; Default case
        (print "Unknown payment type")))))

;; Alternative implementation using direct expressions without variable declarations
(fn processPayment2 [payment]
  ;; Using a simpler approach without local variables
  (if (js-call payment "is" "cash")
    (print "Processing cash payment of $" (get (get payment "values") "amount"))

    (if (js-call payment "is" "creditCard")
      (print "Processing credit card "
             (get (get payment "values") "number")
             " expiring "
             (get (get payment "values") "expiry"))

      (if (js-call payment "is" "check")
        (print "Processing check from account "
               (get (get payment "values") "accountNumber"))

        (print "Unknown payment type")))))

;; Testing the functions
(processPayment payment1)
(processPayment payment2)


;; type inference

;; Define a simple OS enum
(enum OS
  (case macOS)
  (case iOS)
  (case linux)
)

;; With raw values
(enum StatusCode
  (case ok 200)
  (case notFound 404)
  (case serverError 500)
)

;; A function that "installs" based on the OS
(fn install [os]
  (cond
    ((=== os OS.macOS) "Installing on macOS")
    ((=== os OS.iOS)   "Installing on iOS")
    ((=== os OS.linux) "Installing on Linux")
    (else            "Unsupported OS")
  )
)

;; A function with dot notation in equality comparisons
(fn install2 [os]
  (cond
    ((=== os .macOS) "Installing on macOS")
    ((=== os .iOS)   "Installing on iOS")
    ((=== os .linux) "Installing on Linux")
    (else          "Unsupported OS")
  )
)

;; A function demonstrating if statements with enum dot notation
(fn check-status [code]
  (if (=== code .ok)
    "Everything is ok!"
    (if (=== code .notFound)
      "Not found!"
      "Server error!"
    )
  )
)

;; A function demonstrating when with enum dot notation
(fn process-status [code]
  (when (=== code .serverError)
    (print "Critical error detected!")
    "Server error needs attention"
  )
)

;; Test reversed comparison order
(fn reverse-check [code]
  (if (=== .ok code)
    "Status is ok!"
    "Status is not ok!"
  )
)

;; Examples of calling with positional arguments
(let mac-result (install OS.macOS))
(let ios-result (install OS.iOS))
(let linux-result (install OS.linux))
(assert (=== mac-result "Installing on macOS") "install macOS")
(assert (=== ios-result "Installing on iOS") "install iOS")
(assert (=== linux-result "Installing on Linux") "install linux")

;; Using explicit enum references
(let mac-result2 (install OS.macOS))

;; Status code check
(let status (check-status StatusCode.ok))
(let error-status (check-status StatusCode.serverError))
(assert (=== status "Everything is ok!") "status ok")
(assert (=== error-status "Server error!") "status serverError")

;; Test the second install function with dot notation
(let mac-result3 (install2 OS.macOS))
(assert (=== mac-result3 "Installing on macOS") "install2 macOS")

;; Process status with when
(let statusResult (process-status StatusCode.serverError))
(assert (=== statusResult "Server error needs attention") "process-status when")

;; Reverse check
(assert (=== (reverse-check StatusCode.ok) "Status is ok!") "reverse-check ok")
(assert (=== (reverse-check StatusCode.notFound) "Status is not ok!") "reverse-check not ok")

;; Return the status to test
(print status)
(print mac-result3)

;; Test file for unclosed parenthesis errors

(enum Direction2
  (case north)
  (case south)
  (case east)
  (case west)
)

;; Missing closing parenthesis below - deliberate syntax error
(let x 10)

;; This code should not execute
(print "Value is" x)

(print "yo Value is" x) ;; where the intentional error occurs
(print "Value is" x)
