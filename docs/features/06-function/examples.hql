;; Define a simple OS enum.
(enum OS
  (case macOS)
  (case iOS)
  (case linux)
)

;; A function that "installs" based on the OS.
(fn install [os]
  (cond
    ((=== os OS.macOS) (print "Installing on macOS"))
    ((=== os OS.iOS)   (print "Installing on iOS"))
    ((=== os OS.linux) (print "Installing on Linux"))
    (else            (print "Unsupported OS"))
  )
)

;; Positional calls
(install OS.macOS)
(install OS.iOS)
(install OS.linux)