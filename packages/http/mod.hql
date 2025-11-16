;; @hql/http - HTTP utilities for HQL
;; Version: 0.1.0

(fn request [url options]
  "Perform HTTP request using fetch API.

  Args:
    url - URL to fetch
    options - Options object or nil (method, body, headers, etc.)

  Returns:
    Promise resolving to Response object

  Example:
    ;; GET request
    (var resp (request \"https://api.example.com/data\" nil))

    ;; POST request with options
    (var opts {\"method\": \"POST\", \"body\": \"data\"})
    (var resp (request \"https://api.example.com/data\" opts))"
  (if options
    (js/fetch url options)
    (js/fetch url)))

(fn get [url]
  "Perform HTTP GET request.

  Args:
    url - URL to fetch

  Returns:
    Promise resolving to Response object

  Example:
    (var resp (get \"https://api.example.com/data\"))
    (var data (await (.json resp)))"
  (js/fetch url))

(fn post [url body]
  "Perform HTTP POST request with body.

  Args:
    url - URL to post to
    body - Request body (string or object)

  Returns:
    Promise resolving to Response object

  Example:
    (var resp (post \"https://api.example.com/data\" \"hello\"))
    (var data (await (.json resp)))"
  (var opts {"method": "POST", "body": body})
  (js/fetch url opts))

(export [request, get, post])
