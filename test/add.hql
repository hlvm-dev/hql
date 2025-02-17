; add.hql
;; Import the JS module. (Assuming add.js is in the same folder.)
(def addModule (import "./add.js"))

;; Get the 'add' function from the module.
(def add (get addModule "add"))

;; Call the add function with arguments 3 and 4.
(print (add 3 4))

(print (+ 1 2))
