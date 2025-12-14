(let user {name: "Alice" role: "admin" id: 42})

(print "--- Object Matching ---")
(print 
  (match user
    ;; Case 1: Check for guest (Using == for equality!)
    (case {role: r} (if (== r "guest")) "Login as Guest")
      
    ;; Case 2: Check for admin (should match)
    (case {role: r name: n} (if (== r "admin")) (str "Login as Admin: " n))
      
    (default "Access Denied")))

(print "\n--- Syntax as Data ---")
;; demonstrating that "case" and "default" are passed as data to the macro
(let values [10 20])
(print (match values
    (case [x y] (+ x y))
    (default 0)))