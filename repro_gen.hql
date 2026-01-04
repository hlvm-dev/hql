(fn* my-gen [n]
  (var i 0)
  (while (< i n)
    (yield i)
    (= i (+ i 1))))

(let g (my-gen 3))
(print (.next g))
(print (.next g))
(print (.next g))
