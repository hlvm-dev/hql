; @hql/ai - AI-Native Functions for HQL
; Usage: (import [ask generate chat] from "@hql/ai")

; Internal: Call Ollama API
(async fn ollama-generate [prompt model]
  (let response (await
    (js/fetch "http://127.0.0.1:11434/api/generate"
      {"method": "POST",
       "headers": {"Content-Type": "application/json"},
       "body": (js/JSON.stringify {"model": (or model "gemma3:1b"),
                                   "prompt": prompt,
                                   "stream": false})})))
  (let data (await (response .json)))
  (js-get data "response"))

(async fn ollama-chat [messages model]
  (let response (await
    (js/fetch "http://127.0.0.1:11434/api/chat"
      {"method": "POST",
       "headers": {"Content-Type": "application/json"},
       "body": (js/JSON.stringify {"model": (or model "gemma3:1b"),
                                   "messages": messages,
                                   "stream": false})})))
  (let data (await (response .json)))
  (js-get (js-get data "message") "content"))

; Public API

; (ask "question") - Ask AI a question, get text response
(async fn ask [prompt & options]
  (let model (get (first options) "model"))
  (await (ollama-generate prompt model)))

; (generate "description") - Generate code
(async fn generate [description & options]
  (let model (get (first options) "model"))
  (let full-prompt (str "Generate code for: " description ". Output ONLY code, no explanations."))
  (await (ollama-generate full-prompt model)))

; (chat messages) - Multi-turn conversation
(async fn chat [messages & options]
  (let model (get (first options) "model"))
  (await (ollama-chat messages model)))

; (summarize text) - Summarize text
(async fn summarize [text & options]
  (let model (get (first options) "model"))
  (let full-prompt (str "Summarize the following text concisely:\n\n" text))
  (await (ollama-generate full-prompt model)))

(export [ask generate chat summarize])
