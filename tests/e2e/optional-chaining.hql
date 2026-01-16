; Test optional chaining

; Helper for assertions
(fn assert-eq [actual expected message]
  (if (=== actual expected)
    true
    (throw (new Error (+ message " (expected: " expected ", got: " actual ")")))))

; Basic optional property access
(const user null)
(const name user?.name)
(print "null?.name =" name)
(assert-eq name undefined "null?.name yields undefined")

; Nested optional chain
(const data {
  user: {
    address: {
      city: "Seoul"
    }
  }
})
(const city data?.user?.address?.city)
(print "data?.user?.address?.city =" city)
(assert-eq city "Seoul" "nested optional chain returns city")

; Optional chain with non-null value
(const person {name: "Alice", age: 30})
(const personName person?.name)
(print "person?.name =" personName)
(assert-eq personName "Alice" "optional chain with non-null value")

; Mixed optional and regular access
(const company {
  ceo: {
    name: "Bob"
    email: "bob@example.com"
  }
})
(const ceoName company?.ceo.name)
(print "company?.ceo.name =" ceoName)
(assert-eq ceoName "Bob" "mixed optional and regular access")

; Optional method call
(const obj {
  greet: (fn [name] (+ "Hello, " name "!"))
})
(const greeting (obj?.greet "World"))
(print "obj?.greet('World') =" greeting)
(assert-eq greeting "Hello, World!" "optional method call")

(print "=== All optional chaining tests completed ===")
