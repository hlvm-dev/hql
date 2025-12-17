;; HQL LSP Test File
;; Test the following features:

;; 1. Variable binding
(let x 42)
(let message "Hello, HQL!")

;; 2. Function definition
(fn greet [name]
  (str "Hello, " name "!"))

;; 3. Function with multiple params
(fn add [a b]
  (+ a b))

;; 4. Class definition
(class Point
  (field x)
  (field y)
  (fn distance [self other]
    (Math.sqrt (+ (* (- other.x self.x) (- other.x self.x))
                  (* (- other.y self.y) (- other.y self.y))))))

;; 5. Enum definition
(enum Color
  (case Red)
  (case Green)
  (case Blue))

;; 6. Macro definition
(macro when [condition body]
  `(if ~condition ~body nil))

;; Test hover: mouse over 'greet', 'add', 'Point', 'Color'
;; Test completion: type ( at line below and press Ctrl+Space
;; Test go-to-definition: Ctrl+Click on 'greet' below

(greet "World")
(add x 10)

;; Test diagnostics: uncomment line below to see error
;; (let missing-paren
