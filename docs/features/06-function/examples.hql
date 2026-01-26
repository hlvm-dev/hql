;; Define a simple OS enum.
(import [assert] from "@hlvm/assert")

(enum OS
  (case macOS)
  (case iOS)
  (case linux)
)

;; A function that "installs" based on the OS.
(fn install [os]
  (cond
    ((=== os OS.macOS) "Installing on macOS")
    ((=== os OS.iOS)   "Installing on iOS")
    ((=== os OS.linux) "Installing on Linux")
    (else            "Unsupported OS")
  )
)

;; Positional calls
(let mac (install OS.macOS))
(let ios (install OS.iOS))
(let linux (install OS.linux))
(assert (=== mac "Installing on macOS") "install macOS")
(assert (=== ios "Installing on iOS") "install iOS")
(assert (=== linux "Installing on Linux") "install linux")
(print mac)
(print ios)
(print linux)
