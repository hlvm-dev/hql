# @hql/http

HTTP utilities for HQL.

> **Note**: This package is embedded in HQL. No installation required - just import and use.
>
> **Requires**: `--allow-net` permission when running HQL.

## Usage

**In HQL:**
```hql
(import [request, get, post] from "@hql/http")

;; GET request (convenience method)
(var response (get "https://api.example.com/data"))
(var data (await (. response (json))))

;; POST request (convenience method)
(var response (post "https://api.example.com/data" "hello"))

;; Request with custom options
(var opts {"method": "PUT", "body": "data", "headers": {"Content-Type": "application/json"}})
(var response (request "https://api.example.com/data" opts))
```

## API

### `request`

Perform HTTP request using the fetch API with full control over options.

**Arguments:**
- `url` (string) - URL to fetch
- `options` (object|nil) - Request options (method, body, headers, etc.)

**Returns:**
Promise resolving to Response object

**Example:**
```hql
(import [request] from "@hql/http")

;; GET request
(var resp (request "https://api.example.com/users" nil))

;; POST with body and headers
(var opts {
  "method": "POST",
  "body": (js/JSON.stringify {"name": "Alice"}),
  "headers": {"Content-Type": "application/json"}
})
(var resp (request "https://api.example.com/users" opts))
```

### `get`

Perform HTTP GET request (convenience wrapper).

**Arguments:**
- `url` (string) - URL to fetch

**Returns:**
Promise resolving to Response object

**Example:**
```hql
(import [get] from "@hql/http")

(var resp (get "https://api.example.com/users"))
(var users (await (. resp (json))))
```

### `post`

Perform HTTP POST request with body (convenience wrapper).

**Arguments:**
- `url` (string) - URL to post to
- `body` (string) - Request body

**Returns:**
Promise resolving to Response object

**Example:**
```hql
(import [post] from "@hql/http")

(var data (js/JSON.stringify {"name": "Alice", "email": "alice@example.com"}))
(var resp (post "https://api.example.com/users" data))
(var result (await (. resp (json))))
```

## Working with Responses

All functions return a standard Fetch API Response object. Common operations:

```hql
(import [get] from "@hql/http")

(var resp (get "https://api.example.com/data"))

;; Get JSON data
(var data (await (. resp (json))))

;; Get text
(var text (await (. resp (text))))

;; Check status
(var status (get resp :status))
(var ok (get resp :ok))

;; Handle errors
(if (get resp :ok)
  (do (var data (await (. resp (json)))) data)
  (throw (new js/Error "Request failed")))
```

## Error Handling

```hql
(import [get] from "@hql/http")

(try
  (do
    (var resp (get "https://api.example.com/data"))
    (if (get resp :ok)
      (await (. resp (json)))
      (throw (new js/Error (str "HTTP error: " (get resp :status))))))
  (catch err
    (do
      (js/console.log "Request failed:" err)
      nil)))
```

## Examples

### Fetch JSON Data
```hql
(import [get] from "@hql/http")

(var resp (get "https://api.github.com/users/octocat"))
(var user (await (. resp (json))))
(js/console.log "User:" user)
```

### POST JSON Data
```hql
(import [post] from "@hql/http")

(var data (js/JSON.stringify {"title": "Hello", "body": "World"}))
(var resp (post "https://jsonplaceholder.typicode.com/posts" data))
(var result (await (. resp (json))))
(js/console.log "Created:" result)
```

### Custom Headers
```hql
(import [request] from "@hql/http")

(var opts {
  "method": "GET",
  "headers": {
    "Authorization": "Bearer token123",
    "Accept": "application/json"
  }
})
(var resp (request "https://api.example.com/protected" opts))
```

### Handle 404 Errors
```hql
(import [get] from "@hql/http")

(var resp (get "https://httpbin.org/status/404"))
(if (get resp :ok)
  (js/console.log "Success")
  (js/console.log "Error:" (get resp :status)))
```

## Notes

- All functions use the standard Fetch API under the hood
- Requires `--allow-net` permission
- Supports all standard HTTP methods (GET, POST, PUT, DELETE, etc.)
- Compatible with any API that works with Fetch
