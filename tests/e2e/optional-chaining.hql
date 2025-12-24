; Test optional chaining

; Basic optional property access
(const user null)
(const name user?.name)
(print "null?.name =" name)

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

; Optional chain with non-null value
(const person {name: "Alice", age: 30})
(const personName person?.name)
(print "person?.name =" personName)

; Mixed optional and regular access
(const company {
  ceo: {
    name: "Bob"
    email: "bob@example.com"
  }
})
(const ceoName company?.ceo.name)
(print "company?.ceo.name =" ceoName)

; Optional method call
(const obj {
  greet: (fn [name] (+ "Hello, " name "!"))
})
(const greeting (obj?.greet "World"))
(print "obj?.greet('World') =" greeting)

(print "=== All optional chaining tests completed ===")
