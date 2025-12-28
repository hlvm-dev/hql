;; Ambiguous: Module B also exports helper (same name, different implementation)
(fn helper [x] (* x 2))
(export [helper])
