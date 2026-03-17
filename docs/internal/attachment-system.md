# Attachment System Architecture

Internal reference for the GUI-to-LLM attachment pipeline.

## Design Principle

The Deno binary is the **single source of truth**. The Swift GUI is a thin HTTP client that registers files, sends attachment IDs with messages, and renders responses. All storage, validation, materialization, and LLM formatting logic lives in the binary.

```
Swift GUI (thin client)          Deno Binary (SSOT)              LLM API
  │                                │                               │
  │  POST /api/attachments/register│                               │
  │  POST /api/chat + att_ids     │                               │
  │ ─────────────────────────────►│                               │
  │                                │  POST /v1/messages            │
  │                                │  (base64 image/file parts)   │
  │                                │──────────────────────────────►│
  │                                │◄──────────────────────────────│
  │◄──────────────────────────────│  SSE token stream              │
  │  SSE token stream              │                               │
```

---

## Full Flow: User Attaches Image and Sends Chat

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                        USER ATTACHES IMAGE IN GUI                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  SWIFT GUI (thin client)                                                     │
│                                                                              │
│  User drags photo.jpg into chat input area                                   │
│  GUI picks up file path: "/Users/me/Desktop/photo.jpg"                       │
│                                                                              │
│  ┌─────────────────────────────────────────────┐                             │
│  │ HTTP POST /api/attachments/register          │                            │
│  │ Authorization: Bearer <token>                │                            │
│  │ Content-Type: application/json               │                            │
│  │                                              │                            │
│  │ { "path": "/Users/me/Desktop/photo.jpg" }   │                            │
│  └─────────────────────────────────────────────┘                             │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  HTTP SERVER  (http-server.ts:668)                                           │
│                                                                              │
│  router.add("POST", "/api/attachments/register",                             │
│    (req) => handleRegisterAttachment(req))                                   │
│                                                                              │
│  Bearer token validated → routes to handler                                  │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  HANDLER  (handlers/attachments.ts:72-92)                                    │
│                                                                              │
│  handleRegisterAttachment(req)                                               │
│    │                                                                         │
│    ├─ parseJsonBody(req)  →  { path: "/Users/me/Desktop/photo.jpg" }         │
│    ├─ validate: path is non-empty                                            │
│    └─ registerAttachmentFromPath(filePath)                                   │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  ATTACHMENT SERVICE  (service.ts:318-371)                                    │
│                                                                              │
│  registerAttachmentFromPath("/Users/me/Desktop/photo.jpg")                   │
│    │                                                                         │
│    ├─ platform.fs.stat(path)           → { isFile: true, size: 45123 }       │
│    ├─ platform.fs.readFile(path)       → Uint8Array[45123 bytes]             │
│    │                                                                         │
│    └─ registerAttachmentBytes({                                              │
│         fileName: "photo.jpg",                                               │
│         bytes: Uint8Array[45123],                                            │
│         sourcePath: "/Users/me/Desktop/photo.jpg"                            │
│       })                                                                     │
│         │                                                                    │
│         ├─ detectAttachmentMimeType("photo.jpg", bytes)                      │
│         │    ├─ sniffAttachmentMimeType(bytes)                               │
│         │    │    └─ bytes[0]=0xFF bytes[1]=0xD8 bytes[2]=0xFF               │
│         │    │       → "image/jpeg"  (JPEG magic bytes)                      │
│         │    └─ returns "image/jpeg"                                         │
│         │                                                                    │
│         ├─ getAttachmentKind("image/jpeg")  → "image"                        │
│         ├─ getAttachmentSizeLimit("image")  → 20MB                           │
│         ├─ 45123 < 20MB? OK                                                 │
│         │                                                                    │
│         ├─ sha256Hex(bytes) → "a1b2c3d4e5f6..."                             │
│         ├─ attachmentId = "att_a1b2c3d4e5f6..."                              │
│         │                                                                    │
│         ├─ extractAttachmentMetadata("image/jpeg", bytes)                    │
│         │    └─ extractJpegMetadata(bytes)                                   │
│         │         └─ parse SOF marker → { width: 1920, height: 1080 }        │
│         │                                                                    │
│         ├─ validateAttachmentRegistration(record, bytes)                     │
│         │    └─ kind === "image" → return (images always valid)              │
│         │                                                                    │
│         ├─ STORE BLOB (content-addressable, deduped by SHA-256):             │
│         │    ~/.hlvm/attachments/blobs/a1/b2/a1b2c3d4e5f6...                │
│         │                                                                    │
│         └─ STORE RECORD:                                                     │
│              ~/.hlvm/attachments/records/att_a1b2c3d4e5f6....json            │
│              {                                                               │
│                "version": 1,                                                 │
│                "id": "att_a1b2c3d4e5f6...",                                  │
│                "blobSha256": "a1b2c3d4e5f6...",                              │
│                "fileName": "photo.jpg",                                      │
│                "mimeType": "image/jpeg",                                     │
│                "kind": "image",                                              │
│                "size": 45123,                                                │
│                "metadata": { "width": 1920, "height": 1080 },               │
│                "sourcePath": "/Users/me/Desktop/photo.jpg",                  │
│                "createdAt": "2026-03-17T...",                                │
│                "updatedAt": "2026-03-17T...",                                │
│                "lastAccessedAt": "2026-03-17T..."                            │
│              }                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  HTTP RESPONSE ← 201                                                         │
│                                                                              │
│  {                                                                           │
│    "id": "att_a1b2c3d4e5f6...",                                              │
│    "fileName": "photo.jpg",                                                  │
│    "mimeType": "image/jpeg",                                                 │
│    "kind": "image",                                                          │
│    "size": 45123,                                                            │
│    "metadata": { "width": 1920, "height": 1080 }                            │
│  }                                                                           │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  SWIFT GUI                                                                   │
│                                                                              │
│  Stores attachment ID: "att_a1b2c3d4e5f6..."                                 │
│  Shows thumbnail via GET /api/attachments/{id}/content                       │
│                                                                              │
│  User types: "What's in this image?" and presses Send                        │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────┐            │
│  │ HTTP POST /api/chat                                           │           │
│  │ Content-Type: application/json                                │           │
│  │                                                               │           │
│  │ {                                                             │           │
│  │   "mode": "chat",                                            │           │
│  │   "session_id": "sess_xyz...",                                │           │
│  │   "messages": [{                                              │           │
│  │     "role": "user",                                          │           │
│  │     "content": "What's in this image?",                      │           │
│  │     "attachment_ids": ["att_a1b2c3d4e5f6..."]                │           │
│  │   }],                                                         │           │
│  │   "model": "claude-sonnet-4-5-20250929"                       │           │
│  │ }                                                             │           │
│  └───────────────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  HTTP SERVER  (http-server.ts:659)                                           │
│                                                                              │
│  router.add("POST", "/api/chat", (req) => handleChat(req))                   │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  CHAT HANDLER  (handlers/chat.ts:205-632)                                    │
│                                                                              │
│  handleChat(req)                                                             │
│    │                                                                         │
│    ├─ Parse body → ChatRequest { mode, session_id, messages, model }         │
│    ├─ Resolve session + model info                                           │
│    │                                                                         │
│    ├─ STEP 1: VALIDATE ATTACHMENTS  (chat.ts:276-320)                        │
│    │    │                                                                    │
│    │    ├─ hasMediaAttachments = true  (message has attachment_ids)           │
│    │    │                                                                    │
│    │    └─ checkModelAttachmentIds(messages, modelKey, modelInfo)             │
│    │         │  (attachment-policy.ts)                                        │
│    │         ├─ Load records: getAttachmentRecords(["att_a1b2..."])           │
│    │         ├─ record.kind = "image"                                        │
│    │         ├─ Model "claude-sonnet" supports images? YES                   │
│    │         ├─ Model has vision capability? YES                             │
│    │         └─ return: OK (no error)                                        │
│    │                                                                         │
│    ├─ STEP 2: PERSIST MESSAGE  (chat.ts:368-387)                             │
│    │    │                                                                    │
│    │    └─ insertMessage({                                                   │
│    │         session_id: "sess_xyz...",                                       │
│    │         role: "user",                                                   │
│    │         content: "What's in this image?",                               │
│    │         attachment_ids: ["att_a1b2c3d4e5f6..."],  ← stored as JSON     │
│    │       })                                                                │
│    │       → saved to SQLite messages table                                  │
│    │                                                                         │
│    └─ STEP 3: ROUTE TO MODE  (chat.ts:543)                                   │
│         │                                                                    │
│         └─ mode === "chat"  →  handleChatMode(body, session, ...)            │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  DIRECT CHAT  (chat-direct.ts:68-124)                                        │
│                                                                              │
│  handleChatMode(body, session, modelKey, modelInfo, ...)                     │
│    │                                                                         │
│    └─ buildChatProviderMessages({                                            │
│         requestMessages: body.messages,                                      │
│         storedMessages: loadAllMessages(sessionId),                          │
│         modelInfo, modelKey                                                  │
│       })                                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  CONTEXT BUILDER  (chat-context.ts:157-189)                                  │
│                                                                              │
│  buildChatProviderMessages()                                                 │
│    │                                                                         │
│    ├─ STEP A: GET MATERIALIZATION OPTIONS  (chat-context.ts:160)             │
│    │    │                                                                    │
│    │    └─ getConversationMaterializationOptionsForModel(modelKey, modelInfo) │
│    │         │  (attachment-policy.ts)                                        │
│    │         ├─ model = "claude-sonnet-4-5-20250929"                          │
│    │         ├─ provider = "anthropic"                                        │
│    │         ├─ anthropic supports: ["image", "pdf", "text"]                 │
│    │         ├─ model has vision? YES                                         │
│    │         └─ return: { preferTextKinds: [] }                              │
│    │            (no text degradation — model handles images natively)         │
│    │                                                                         │
│    ├─ STEP B: BUILD REPLAY MESSAGES  (chat-context.ts:165)                   │
│    │    │                                                                    │
│    │    └─ normalizeRequestMessages(messages, materializationOptions)         │
│    │         │  (chat-context.ts:267-284)                                     │
│    │         │                                                               │
│    │         └─ for each message:                                            │
│    │              createReplayMessage({                                      │
│    │                role: "user",                                            │
│    │                content: "What's in this image?",                        │
│    │                attachmentIds: ["att_a1b2c3d4e5f6..."],                  │
│    │                attachmentMaterializationOptions                         │
│    │              })                                                         │
│    │                                                                         │
│    └─ STEP C: RESOLVE ATTACHMENTS  (chat-context.ts:584)                     │
│         │                                                                    │
│         └─ resolveAttachments(["att_a1b2..."], options)                       │
│              │  (chat-context.ts:625-631)                                     │
│              │                                                               │
│              └─ materializeConversationAttachments(                           │
│                   ["att_a1b2c3d4e5f6..."],                                   │
│                   { preferTextKinds: [] }                                    │
│                 )                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  MATERIALIZATION  (service.ts:87-138)                                        │
│                                                                              │
│  materializeConversationAttachment("att_a1b2...", { preferTextKinds: [] })   │
│    │                                                                         │
│    ├─ materializeAttachment("att_a1b2...", "default")                        │
│    │    │  (service.ts:494-505)                                              │
│    │    │                                                                    │
│    │    ├─ getRequiredAttachmentRecords(["att_a1b2..."])                      │
│    │    │    └─ reads ~/.hlvm/attachments/records/att_a1b2....json            │
│    │    │                                                                    │
│    │    ├─ touchAttachmentRecord(record)  → updates lastAccessedAt           │
│    │    │                                                                    │
│    │    └─ prepareAttachmentForProfile(record, "default")                    │
│    │         │  (service.ts:456-492)                                         │
│    │         │                                                               │
│    │         ├─ Check cache: ~/.hlvm/attachments/prepared/default/att_a1b2.. │
│    │         │    └─ cache miss → continue                                   │
│    │         │                                                               │
│    │         ├─ Read blob: ~/.hlvm/attachments/blobs/a1/b2/a1b2c3...        │
│    │         │    → Uint8Array[45123 raw JPEG bytes]                         │
│    │         │                                                               │
│    │         ├─ encodeBase64(bytes)  → "/9j/4AAQSkZJRg..."                   │
│    │         │                                                               │
│    │         ├─ Write cache: prepared/default/att_a1b2....json               │
│    │         │                                                               │
│    │         └─ return PreparedAttachment {                                  │
│    │              attachmentId: "att_a1b2...",                                │
│    │              fileName: "photo.jpg",                                     │
│    │              mimeType: "image/jpeg",                                    │
│    │              kind: "image",                                             │
│    │              size: 45123,                                               │
│    │              data: "/9j/4AAQSkZJRg..."  (base64)                        │
│    │            }                                                            │
│    │                                                                         │
│    ├─ conversationKind = getConversationAttachmentKind("image/jpeg")          │
│    │    → "image"                                                            │
│    │                                                                         │
│    ├─ shouldUseBinary?                                                       │
│    │    conversationKind = "image"  (not null)                               │
│    │    conversationKind !== "text"  (true)                                  │
│    │    preferTextKinds.includes("image")? NO                                │
│    │    → shouldUseBinary = TRUE                                             │
│    │                                                                         │
│    └─ return BinaryConversationAttachmentPayload:                            │
│         {                                                                    │
│           mode: "binary",                                                    │
│           attachmentId: "att_a1b2c3d4e5f6...",                               │
│           fileName: "photo.jpg",                                             │
│           mimeType: "image/jpeg",                                            │
│           kind: "image",                                                     │
│           conversationKind: "image",                                         │
│           size: 45123,                                                       │
│           data: "/9j/4AAQSkZJRg..."                                          │
│         }                                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PROVIDER MESSAGE ASSEMBLY  (chat-context.ts:649-682)                        │
│                                                                              │
│  toProviderReplayMessages()                                                  │
│    │                                                                         │
│    └─ ProviderMessage:                                                       │
│         {                                                                    │
│           role: "user",                                                      │
│           content: "What's in this image?",                                  │
│           attachments: [{                                                    │
│             mode: "binary",                                                  │
│             mimeType: "image/jpeg",                                          │
│             data: "/9j/4AAQSkZJRg...",                                       │
│             ...                                                              │
│           }]                                                                 │
│         }                                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  AI CHAT CALL  (chat-direct.ts:94-100)                                       │
│                                                                              │
│  ai.chat(providerMessages, { model, tools, ... })                            │
│    │                                                                         │
│    └─ routes to SDK engine: chatWithSdk()                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  SDK RUNTIME  (sdk-runtime.ts:350-401)                                       │
│                                                                              │
│  convertToSdkMessages(providerMessages)                                      │
│    │                                                                         │
│    ├─ msg.role === "user"                                                    │
│    ├─ msg.attachments?.length > 0  → YES                                     │
│    │                                                                         │
│    ├─ Build multimodal content array:                                        │
│    │                                                                         │
│    │   content = []                                                          │
│    │                                                                         │
│    │   msg.content exists?  YES                                              │
│    │   → content.push({ type: "text", text: "What's in this image?" })       │
│    │                                                                         │
│    │   for attachment in msg.attachments:                                    │
│    │     attachment.mode === "binary"                                         │
│    │     attachment.mimeType === "image/jpeg"                                 │
│    │     mimeType.startsWith("image/") → YES                                 │
│    │                                                                         │
│    │   → content.push({                                                      │
│    │       type: "image",                    ← AI SDK image part type        │
│    │       image: "/9j/4AAQSkZJRg..."        ← base64 JPEG data             │
│    │     })                                                                  │
│    │                                                                         │
│    └─ ModelMessage:                                                          │
│         {                                                                    │
│           role: "user",                                                      │
│           content: [                                                         │
│             { type: "text",  text: "What's in this image?" },                │
│             { type: "image", image: "/9j/4AAQSkZJRg..." }                    │
│           ]                                                                  │
│         }                                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  LLM API CALL  (sdk-runtime.ts:642-671)                                      │
│                                                                              │
│  chatWithSdk(spec)                                                           │
│    │                                                                         │
│    ├─ model = createSdkLanguageModel("anthropic", "claude-sonnet-4-5-...")    │
│    │    └─ @ai-sdk/anthropic → Anthropic provider                            │
│    │                                                                         │
│    ├─ sdkMessages = convertToSdkMessages(messages)                           │
│    │                                                                         │
│    └─ streamText({                                                           │
│         model,                                                               │
│         messages: sdkMessages,     ← contains { type:"image", image:"..." }  │
│         tools,                                                               │
│         maxTokens,                                                           │
│         temperature,                                                         │
│       })                                                                     │
│                                                                              │
│       AI SDK internally converts to Anthropic API format:                    │
│         POST https://api.anthropic.com/v1/messages                           │
│         {                                                                    │
│           "model": "claude-sonnet-4-5-20250929",                              │
│           "messages": [{                                                     │
│             "role": "user",                                                  │
│             "content": [                                                     │
│               { "type": "text", "text": "What's in this image?" },           │
│               {                                                              │
│                 "type": "image",                                             │
│                 "source": {                                                  │
│                   "type": "base64",                                          │
│                   "media_type": "image/jpeg",                                │
│                   "data": "/9j/4AAQSkZJRg..."                                │
│                 }                                                            │
│               }                                                              │
│             ]                                                                │
│           }],                                                                │
│           "stream": true                                                     │
│         }                                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  ANTHROPIC API                                                               │
│                                                                              │
│  Claude processes image + text → generates response                          │
│  Streams SSE tokens back                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  RESPONSE STREAMING  (chat-direct.ts → chat.ts)                              │
│                                                                              │
│  streamText yields tokens → SSE events → GUI                                 │
│                                                                              │
│  SSE to GUI:                                                                 │
│    data: {"type":"text_delta","text":"This image shows"}                      │
│    data: {"type":"text_delta","text":" a sunset over"}                        │
│    data: {"type":"text_delta","text":" the ocean..."}                         │
│    data: {"type":"message_stop"}                                             │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  SWIFT GUI                                                                   │
│                                                                              │
│  Renders streamed tokens in chat bubble:                                     │
│  "This image shows a sunset over the ocean..."                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Disk State After Flow

```
~/.hlvm/
└── attachments/
    ├── records/
    │   └── att_a1b2c3d4e5f6.json     ← metadata (kind, mime, dimensions)
    ├── blobs/
    │   └── a1/b2/a1b2c3d4e5f6...     ← raw JPEG bytes (45KB)
    └── prepared/
        └── default/
            └── att_a1b2c3d4e5f6.json  ← base64 cached (60KB)

SQLite DB (messages table):
┌────────────┬──────┬─────────────────────────┬────────────────────────┐
│ session_id │ role │ content                 │ attachment_ids         │
├────────────┼──────┼─────────────────────────┼────────────────────────┤
│ sess_xyz   │ user │ What's in this image?   │ ["att_a1b2c3d4e5f6"]  │
│ sess_xyz   │ asst │ This shows a sunset...  │ null                  │
└────────────┴──────┴─────────────────────────┴────────────────────────┘
```

---

## Data Shape at Each Boundary

| Boundary | Shape |
|----------|-------|
| GUI → Server | `attachment_ids: string[]` in chat request |
| DB column | `'["att_a1b2c3d4e5f6"]'` (JSON string) |
| After materialization | `ConversationAttachmentPayload { mode:"binary", data:"base64...", mimeType:"image/jpeg" }` |
| In ProviderMessage | `attachments: ConversationAttachmentPayload[]` |
| After SDK convert | `content: [{ type:"text", text:"..." }, { type:"image", image:"base64..." }]` |
| Anthropic API wire | `{ type:"image", source:{ type:"base64", media_type:"image/jpeg", data:"..." } }` |

---

## Provider-Aware Degradation

Not all models support all attachment kinds. The attachment policy layer handles this:

```
                 Model supports images natively?
                          │
                    ┌─────┴─────┐
                   YES          NO
                    │            │
              Binary mode    preferTextKinds: ["image"]
              (base64 img)   → text extraction fallback
                    │            │
              { type:"image",   { type:"text",
                image:"..." }    text:"[cannot extract
                                       text from image]" }
```

Per-provider support matrix:

| Provider | Image | PDF | Audio | Video | Text |
|----------|-------|-----|-------|-------|------|
| Anthropic | Y | Y | - | - | Y |
| OpenAI | Y | Y | - | - | Y |
| Google | Y | Y | Y | Y | Y |
| Ollama | Y | - | - | - | Y |

When a model lacks native support for a kind, `preferTextKinds` forces text extraction.
PDFs on Ollama → extracted to plaintext. Audio on Anthropic → rejected at validation.

---

## Cleanup Changes (2026-03-17)

### Before

```
metadata.ts
  ├─ TEXT_ATTACHMENT_MIME_TYPES (private)     ← DUPLICATE
  ├─ getFileExtension() (private)            ← DUPLICATE
  └─ sniffAttachmentMimeType() (exported)    ← never imported externally

extractors.ts
  ├─ DIRECT_TEXT_MIME_TYPES (private)        ← DUPLICATE of metadata.ts
  ├─ getFileExtension() (private)            ← DUPLICATE of metadata.ts
  └─ extractionProfile in options            ← always falls back to providerProfile

types.ts
  └─ extractionProfile?: string              ← never set by any caller

service.ts
  ├─ prepareAttachment() (exported)          ← 0 external callers
  ├─ prepareAttachments() (exported)         ← 0 external callers
  ├─ materializeAttachments() (exported)     ← 0 external callers (only by prepareAttachments)
  ├─ prepareConversationAttachment()         ← private, does all the work
  └─ materializeConversationAttachment()     ← exported, just forwards to above
```

### After

```
metadata.ts
  ├─ TEXT_ATTACHMENT_MIME_TYPES (exported)    ← single source
  ├─ getFileExtension() (exported)           ← single source
  └─ sniffAttachmentMimeType() (private)     ← matches actual usage

extractors.ts
  ├─ imports TEXT_ATTACHMENT_MIME_TYPES       ← from metadata.ts
  ├─ imports getFileExtension                ← from metadata.ts
  └─ uses providerProfile directly           ← no extractionProfile indirection

types.ts
  └─ (extractionProfile removed)             ← dead field deleted

service.ts
  ├─ (prepareAttachment deleted)             ← dead code removed
  ├─ (prepareAttachments deleted)            ← dead code removed
  ├─ (materializeAttachments deleted)        ← dead code removed
  └─ materializeConversationAttachment()     ← directly contains the logic (flattened)
```

Net: ~50 lines removed from source, ~200 lines of tests added.

---

## Test Coverage

| Layer | Test File | Count |
|-------|-----------|-------|
| Service (register, dedup, materialize) | `tests/unit/attachments/service.test.ts` | 9 |
| HTTP handlers (register, upload, get, content) | `tests/unit/cli/attachment-handlers.test.ts` | 7 |
| Attachment policy (model capability) | `tests/unit/cli/attachment-policy.test.ts` | 7 |
| SDK runtime (attachment → LLM parts) | `tests/unit/agent/sdk-runtime.test.ts` | 13 |

### Untested seam

The `buildChatProviderMessages()` → `resolveAttachments()` → `materializeConversationAttachments()` → `convertToSdkMessages()` integration path is tested per-unit but not wired together. An integration test at the `buildChatProviderMessages` boundary would close this gap.

---

## File Map

| Component | File |
|-----------|------|
| HTTP endpoints | `src/hlvm/cli/repl/handlers/attachments.ts` |
| HTTP server routing | `src/hlvm/cli/repl/http-server.ts` |
| Storage + materialization | `src/hlvm/attachments/service.ts` |
| Types + errors | `src/hlvm/attachments/types.ts` |
| MIME detection + metadata | `src/hlvm/attachments/metadata.ts` |
| Text extraction | `src/hlvm/attachments/extractors.ts` |
| Chat handler | `src/hlvm/cli/repl/handlers/chat.ts` |
| Context building | `src/hlvm/cli/repl/handlers/chat-context.ts` |
| Attachment policy | `src/hlvm/cli/attachment-policy.ts` |
| SDK message conversion | `src/hlvm/providers/sdk-runtime.ts` |
| Session protocol | `src/hlvm/runtime/session-protocol.ts` |
