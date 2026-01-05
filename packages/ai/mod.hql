; @hql/ai - AI-Native Functions for HQL
; Usage: (import [ask] from "@hql/ai")
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
;
; Works with ALL async generator functions, not just AI.

; ============================================================================
; Internal: Streaming generator using Ollama API
; ============================================================================

; Process stream and yield tokens - returns async generator
(async fn* stream-tokens [response]
  "Yield tokens from a streaming response"
  (let body response.body)
  (let reader (body.getReader))
  (let decoder (new js/TextDecoder))
  (var done false)

  (while (not done)
    (let chunk (await (reader.read)))
    (if chunk.done
      (= done true)
      (do
        (let text (decoder.decode chunk.value))
        (let lines (text.split "\n"))
        ; Process each line using index
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
          (= i (+ i 1)))))))

; Process chat stream and yield tokens
(async fn* stream-chat-tokens [response]
  "Yield tokens from a streaming chat response"
  (let body response.body)
  (let reader (body.getReader))
  (let decoder (new js/TextDecoder))
  (var done false)

  (while (not done)
    (let chunk (await (reader.read)))
    (if chunk.done
      (= done true)
      (do
        (let text (decoder.decode chunk.value))
        (let lines (text.split "\n"))
        ; Process each line using index
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
          (= i (+ i 1)))))))

; Internal: Non-streaming API
(async fn ollama-generate [prompt model]
  (let response (await
    (js/fetch "http://127.0.0.1:11434/api/generate"
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": (or model "gemma3:1b")
                                   "prompt": prompt
                                   "stream": false})})))
  (let data (await (response.json)))
  data.response)

(async fn ollama-chat-sync [messages model]
  (let response (await
    (js/fetch "http://127.0.0.1:11434/api/chat"
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": (or model "gemma3:1b")
                                   "messages": messages
                                   "stream": false})})))
  (let data (await (response.json)))
  data.message.content)

; ============================================================================
; Public API - Streaming (async generators)
; ============================================================================

; (ask "question") - Returns async generator that yields tokens
; REPL automatically streams the output
(async fn* ask [prompt & options]
  "Stream AI response. Returns async generator - REPL streams automatically."
  (let opts (first options))
  (let model (when opts opts.model))
  (let response (await
    (js/fetch "http://127.0.0.1:11434/api/generate"
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": (or model "gemma3:1b")
                                   "prompt": prompt
                                   "stream": true})})))
  (yield* (stream-tokens response)))

; (generate "description") - Stream code generation
(async fn* generate [description & options]
  "Stream code generation. Returns async generator."
  (let opts (first options))
  (let model (when opts opts.model))
  (let full-prompt (str "Generate code for: " description ". Output ONLY code, no explanations."))
  (let response (await
    (js/fetch "http://127.0.0.1:11434/api/generate"
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": (or model "gemma3:1b")
                                   "prompt": full-prompt
                                   "stream": true})})))
  (yield* (stream-tokens response)))

; (chat messages) - Stream chat response
(async fn* chat [messages & options]
  "Stream chat response. Returns async generator."
  (let opts (first options))
  (let model (when opts opts.model))
  (let response (await
    (js/fetch "http://127.0.0.1:11434/api/chat"
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": (or model "gemma3:1b")
                                   "messages": messages
                                   "stream": true})})))
  (yield* (stream-chat-tokens response)))

; (summarize text) - Stream summarization
(async fn* summarize [text & options]
  "Stream summarization. Returns async generator."
  (let opts (first options))
  (let model (when opts opts.model))
  (let full-prompt (str "Summarize the following text concisely:\n\n" text))
  (let response (await
    (js/fetch "http://127.0.0.1:11434/api/generate"
      {"method": "POST"
       "headers": {"Content-Type": "application/json"}
       "body": (js/JSON.stringify {"model": (or model "gemma3:1b")
                                   "prompt": full-prompt
                                   "stream": true})})))
  (yield* (stream-tokens response)))

; ============================================================================
; DEPRECATED: *-sync variants are no longer needed!
; With HQL's enhanced await, just use (await (ask ...)) instead of (ask-sync ...)
; ============================================================================

(export [ask generate chat summarize])
