; @hql/ai - AI-Native Functions for HQL
; Usage: (import [ask] from "@hql/ai")
;
; SSOT: All functions delegate to globalThis.ai provider API
; No direct Ollama fetch - 100% Single Source of Truth
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
; Provider Helper - Gets globalThis.ai (SSOT)
; ============================================================================

(fn get-ai-provider []
  "Get the AI provider from globalThis.ai. Throws if not available."
  (let ai js/globalThis.ai)
  (when (not ai)
    (throw (new js/Error "AI provider not available. Ensure REPL is initialized.")))
  (when (not ai.generate)
    (throw (new js/Error "AI provider missing generate method.")))
  ai)

; ============================================================================
; Config Helpers - Read from globalThis.config snapshot (SSOT)
; ============================================================================

(fn get-config []
  "Get config snapshot from globalThis.config"
  (let cfg-api (js-get js/globalThis "config"))
  (if cfg-api
      (or (js-get cfg-api "snapshot") {})
      {}))

(fn get-temperature [opts]
  "Get temperature from: opts > config > default"
  (when (and opts (isNumber opts.temperature))
    (return opts.temperature))
  (let cfg-temp (js-get (get-config) "temperature"))
  (if (isNumber cfg-temp) cfg-temp 0.7))

(fn get-max-tokens [opts]
  "Get maxTokens from: opts > config > default"
  (when (and opts (isNumber opts.maxTokens))
    (return opts.maxTokens))
  (let cfg-max (js-get (get-config) "maxTokens"))
  (if (isNumber cfg-max) cfg-max 4096))

(fn get-model [opts]
  "Get model from: opts > config > nil (let provider use default)"
  (when (and opts opts.model)
    (return opts.model))
  (let cfg-model (js-get (get-config) "model"))
  (when (and cfg-model (isString cfg-model))
    cfg-model))

; ============================================================================
; Public API - SSOT via globalThis.ai
; ============================================================================

; (ask "question") - Returns async generator that yields tokens
; REPL automatically streams the output
; SSOT: Delegates to globalThis.ai.generate()
(async fn* ask [prompt & options]
  "Stream AI response via provider SSOT. Returns async generator."
  (let opts (first options))
  (let ai (get-ai-provider))
  (let provider-opts {"temperature": (get-temperature opts)
                      "maxTokens": (get-max-tokens opts)
                      "model": (get-model opts)})
  (yield* (ai.generate prompt provider-opts)))

; (generate "description") - Stream code generation
; SSOT: Delegates to globalThis.ai.generate()
(async fn* generate [description & options]
  "Stream code generation via provider SSOT. Returns async generator."
  (let opts (first options))
  (let ai (get-ai-provider))
  (let full-prompt (str "Generate code for: " description ". Output ONLY code, no explanations."))
  (let provider-opts {"temperature": (get-temperature opts)
                      "maxTokens": (get-max-tokens opts)
                      "model": (get-model opts)})
  (yield* (ai.generate full-prompt provider-opts)))

; (chat messages) - Stream chat response
; SSOT: Delegates to globalThis.ai.chat()
(async fn* chat [messages & options]
  "Stream chat response via provider SSOT. Returns async generator."
  (let opts (first options))
  (let ai (get-ai-provider))
  (let provider-opts {"temperature": (get-temperature opts)
                      "maxTokens": (get-max-tokens opts)
                      "model": (get-model opts)})
  (yield* (ai.chat messages provider-opts)))

; (summarize text) - Stream summarization
; SSOT: Delegates to globalThis.ai.generate()
(async fn* summarize [text & options]
  "Stream summarization via provider SSOT. Returns async generator."
  (let opts (first options))
  (let ai (get-ai-provider))
  (let full-prompt (str "Summarize the following text concisely:\n\n" text))
  (let provider-opts {"temperature": (get-temperature opts)
                      "maxTokens": (get-max-tokens opts)
                      "model": (get-model opts)})
  (yield* (ai.generate full-prompt provider-opts)))

(export [ask generate chat summarize])
