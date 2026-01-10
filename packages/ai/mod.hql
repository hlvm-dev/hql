; @hql/ai - AI-Native Functions for HQL
; Usage: (import [ask] from "@hql/ai")
;
; Config is read from globalThis.__hqlConfig (set by HQL CLI)
; Supports: endpoint, model, temperature, maxTokens
;
; FUNDAMENTAL DUAL-MODE API:
; One function, two behaviors - determined by how YOU call it:
;
;   (ask "hello")           → STREAMING: Live token-by-token output
;   (await (ask "hello"))   → COMPLETION: Returns full response as string
;
; This is a fundamental HQL language feature:
; - Direct call returns async generator → REPL streams automatically
; - await consumes the generator → returns concatenated result

; ============================================================================
; Config Helpers - ALWAYS read fresh (no caching for live reload)
; ============================================================================

; Get config object (fresh read each call)
(fn get-config []
  (or js/globalThis.__hqlConfig {}))

; Get endpoint from: env > config > default
(fn get-endpoint []
  (let env-endpoint (when (isDefined js/Deno)
                      (when js/Deno.env
                        (js/Deno.env.get "HQL_ENDPOINT"))))
  (or env-endpoint
      (or (js-get (get-config) "endpoint")
          "http://localhost:11434")))

; Get model from: opts > env > config > default
; Model format in config: "provider/model" -> extract just model name for Ollama
(fn extract-model-name [m]
  (let idx (m.indexOf "/"))
  (if (>= idx 0)
      (m.slice (+ idx 1))
      m))

(fn get-model [opts]
  ; First check opts.model - EXTRACT model name
  (when (and opts opts.model)
    (return (extract-model-name opts.model)))
  ; Then check env var
  (let env-model (when (isDefined js/Deno)
                   (when js/Deno.env
                     (js/Deno.env.get "HQL_MODEL"))))
  (when env-model
    (return (extract-model-name env-model)))
  ; Then check config
  (let cfg-model (js-get (get-config) "model"))
  (if cfg-model
      (extract-model-name cfg-model)
      "llama3.2"))

; Get temperature from: opts > config > default
(fn get-temperature [opts]
  (when (and opts (isNumber opts.temperature))
    (return opts.temperature))
  (let cfg-temp (js-get (get-config) "temperature"))
  (if (isNumber cfg-temp) cfg-temp 0.7))

; Get maxTokens from: opts > config > default
(fn get-max-tokens [opts]
  (when (and opts (isNumber opts.maxTokens))
    (return opts.maxTokens))
  (let cfg-max (js-get (get-config) "maxTokens"))
  (if (isNumber cfg-max) cfg-max 4096))

; Get stream option from: opts > default (true)
(fn get-should-stream [opts]
  (if (and opts (=== opts.stream false))
      false
      true))

; ============================================================================
; Internal: Streaming generator using Ollama API
; ============================================================================

; Process stream and yield tokens - with proper buffering for partial chunks
(async fn* stream-tokens [response]
  "Yield tokens from a streaming response"
  (let body response.body)
  (let reader (body.getReader))
  (let decoder (new js/TextDecoder))
  (var buffer "")
  (var done false)

  (while (not done)
    (let chunk (await (reader.read)))
    (if chunk.done
      (= done true)
      (do
        ; Append to buffer (handles partial JSON across chunks)
        (= buffer (str buffer (decoder.decode chunk.value)))
        (let lines (buffer.split "\n"))
        ; Keep last potentially incomplete line in buffer
        (= buffer (or (lines.pop) ""))
        (var i 0)
        (while (< i lines.length)
          (let line (js-get lines i))
          (when (> line.length 0)
            (try
              (let json (js/JSON.parse line))
              (let token json.response)
              (when token
                (yield token))
              (catch e nil)))
          (= i (+ i 1))))))

  ; Process any remaining data in buffer
  (when (> buffer.length 0)
    (try
      (let json (js/JSON.parse buffer))
      (let token json.response)
      (when token
        (yield token))
      (catch e nil))))

; Process chat stream and yield tokens - with proper buffering
(async fn* stream-chat-tokens [response]
  "Yield tokens from a streaming chat response"
  (let body response.body)
  (let reader (body.getReader))
  (let decoder (new js/TextDecoder))
  (var buffer "")
  (var done false)

  (while (not done)
    (let chunk (await (reader.read)))
    (if chunk.done
      (= done true)
      (do
        ; Append to buffer (handles partial JSON across chunks)
        (= buffer (str buffer (decoder.decode chunk.value)))
        (let lines (buffer.split "\n"))
        ; Keep last potentially incomplete line in buffer
        (= buffer (or (lines.pop) ""))
        (var i 0)
        (while (< i lines.length)
          (let line (js-get lines i))
          (when (> line.length 0)
            (try
              (let json (js/JSON.parse line))
              (let msg json.message)
              (when msg
                (let token msg.content)
                (when token
                  (yield token)))
              (catch e nil)))
          (= i (+ i 1))))))

  ; Process any remaining data in buffer
  (when (> buffer.length 0)
    (try
      (let json (js/JSON.parse buffer))
      (let msg json.message)
      (when msg
        (let token msg.content)
        (when token
          (yield token)))
      (catch e nil))))

; ============================================================================
; Public API - Streaming (async generators)
; ============================================================================

; (ask "question") - Returns async generator that yields tokens
; REPL automatically streams the output
(async fn* ask [prompt & options]
  "Stream AI response. Returns async generator - REPL streams automatically."
  (let opts (first options))
  (let model (get-model opts))
  (let temp (get-temperature opts))
  (let max-tok (get-max-tokens opts))
  (let endpoint (get-endpoint))
  (let should-stream (get-should-stream opts))
  (let response (await
    (js/fetch (str endpoint "/api/generate")
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": model
                                   "prompt": prompt
                                   "stream": should-stream
                                   "options": {"temperature": temp
                                               "num_predict": max-tok}})})))

  ; Check for HTTP errors
  (when (not response.ok)
    (throw (new js/Error (str "AI request failed: " response.status))))

  ; Streaming or non-streaming path
  (if should-stream
      (yield* (stream-tokens response))
      (do
        (let data (await (response.json)))
        (yield (or data.response "")))))

; (generate "description") - Stream code generation
(async fn* generate [description & options]
  "Stream code generation. Returns async generator."
  (let opts (first options))
  (let model (get-model opts))
  (let temp (get-temperature opts))
  (let max-tok (get-max-tokens opts))
  (let endpoint (get-endpoint))
  (let should-stream (get-should-stream opts))
  (let full-prompt (str "Generate code for: " description ". Output ONLY code, no explanations."))
  (let response (await
    (js/fetch (str endpoint "/api/generate")
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": model
                                   "prompt": full-prompt
                                   "stream": should-stream
                                   "options": {"temperature": temp
                                               "num_predict": max-tok}})})))

  ; Check for HTTP errors
  (when (not response.ok)
    (throw (new js/Error (str "AI request failed: " response.status))))

  ; Streaming or non-streaming path
  (if should-stream
      (yield* (stream-tokens response))
      (do
        (let data (await (response.json)))
        (yield (or data.response "")))))

; (chat messages) - Stream chat response
(async fn* chat [messages & options]
  "Stream chat response. Returns async generator."
  (let opts (first options))
  (let model (get-model opts))
  (let temp (get-temperature opts))
  (let max-tok (get-max-tokens opts))
  (let endpoint (get-endpoint))
  (let should-stream (get-should-stream opts))
  (let response (await
    (js/fetch (str endpoint "/api/chat")
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": model
                                   "messages": messages
                                   "stream": should-stream
                                   "options": {"temperature": temp
                                               "num_predict": max-tok}})})))

  ; Check for HTTP errors
  (when (not response.ok)
    (throw (new js/Error (str "Chat request failed: " response.status))))

  ; Streaming or non-streaming path
  (if should-stream
      (yield* (stream-chat-tokens response))
      (do
        (let data (await (response.json)))
        (let content (when data.message data.message.content))
        (yield (or content "")))))

; (summarize text) - Stream summarization
(async fn* summarize [text & options]
  "Stream summarization. Returns async generator."
  (let opts (first options))
  (let model (get-model opts))
  (let temp (get-temperature opts))
  (let max-tok (get-max-tokens opts))
  (let endpoint (get-endpoint))
  (let should-stream (get-should-stream opts))
  (let full-prompt (str "Summarize the following text concisely:\n\n" text))
  (let response (await
    (js/fetch (str endpoint "/api/generate")
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": model
                                   "prompt": full-prompt
                                   "stream": should-stream
                                   "options": {"temperature": temp
                                               "num_predict": max-tok}})})))

  ; Check for HTTP errors
  (when (not response.ok)
    (throw (new js/Error (str "AI request failed: " response.status))))

  ; Streaming or non-streaming path
  (if should-stream
      (yield* (stream-tokens response))
      (do
        (let data (await (response.json)))
        (yield (or data.response "")))))

(export [ask generate chat summarize])
