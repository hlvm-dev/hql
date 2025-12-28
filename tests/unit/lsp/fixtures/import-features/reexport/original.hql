;; Re-export chain: Original source
(fn greet [name] (str "Hello, " name "!"))
(fn farewell [name] (str "Goodbye, " name "!"))
(var VERSION "1.0.0")

(export [greet farewell VERSION])
