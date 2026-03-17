/**
 * OpenAPI Shared Component Schemas
 *
 * This file exists solely so swagger-jsdoc can parse its JSDoc blocks.
 * It has no runtime exports.
 */

/**
 * @openapi
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       description: Token returned at server start via HLVM_AUTH_TOKEN or auto-generated UUID.
 *   schemas:
 *     SessionRow:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         title:
 *           type: string
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *         message_count:
 *           type: integer
 *         session_version:
 *           type: integer
 *         metadata:
 *           type: string
 *           nullable: true
 *           description: Opaque JSON string stored by the client.
 *       required: [id, created_at, updated_at, message_count, session_version]
 *     MessageRow:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         session_id:
 *           type: string
 *         order:
 *           type: integer
 *           description: Monotonic order within the session.
 *         role:
 *           type: string
 *           enum: [system, user, assistant, tool]
 *         content:
 *           type: string
 *         client_turn_id:
 *           type: string
 *           nullable: true
 *         request_id:
 *           type: string
 *           nullable: true
 *         sender_type:
 *           type: string
 *           nullable: true
 *           enum: [user, llm, agent, system]
 *         sender_detail:
 *           type: string
 *           nullable: true
 *         attachment_ids:
 *           type: string
 *           nullable: true
 *           description: JSON array of attachment IDs.
 *         tool_calls:
 *           type: string
 *           nullable: true
 *           description: JSON-encoded tool call array.
 *         tool_name:
 *           type: string
 *           nullable: true
 *         tool_call_id:
 *           type: string
 *           nullable: true
 *         cancelled:
 *           type: integer
 *           description: 0 or 1 (SQLite boolean).
 *         created_at:
 *           type: string
 *           format: date-time
 *       required: [id, session_id, order, role, content, created_at]
 *     PagedMessages:
 *       type: object
 *       properties:
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/MessageRow'
 *         total:
 *           type: integer
 *         has_more:
 *           type: boolean
 *         session_version:
 *           type: integer
 *         cursor:
 *           type: integer
 *           nullable: true
 *       required: [messages, total, has_more, session_version]
 *     AttachmentMetadata:
 *       type: object
 *       properties:
 *         width:
 *           type: integer
 *           nullable: true
 *         height:
 *           type: integer
 *           nullable: true
 *         duration:
 *           type: number
 *           nullable: true
 *         pages:
 *           type: integer
 *           nullable: true
 *     AttachmentRecord:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         blobSha256:
 *           type: string
 *         fileName:
 *           type: string
 *         mimeType:
 *           type: string
 *         kind:
 *           type: string
 *           enum: [image, audio, video, pdf, text, document, file]
 *         size:
 *           type: integer
 *         sourcePath:
 *           type: string
 *           nullable: true
 *         metadata:
 *           allOf:
 *             - $ref: '#/components/schemas/AttachmentMetadata'
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         lastAccessedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *       required: [id, blobSha256, fileName, mimeType, kind, size, createdAt, updatedAt]
 *     RuntimeMessageAttachment:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         file_name:
 *           type: string
 *         mime_type:
 *           type: string
 *         kind:
 *           type: string
 *           enum: [image, audio, video, pdf, text, document, file]
 *         size:
 *           type: integer
 *         source_path:
 *           type: string
 *           nullable: true
 *         metadata:
 *           allOf:
 *             - $ref: '#/components/schemas/AttachmentMetadata'
 *           nullable: true
 *         content_url:
 *           type: string
 *       required: [id, file_name, mime_type, kind, size, content_url]
 *     RuntimeSessionMessage:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         session_id:
 *           type: string
 *         order:
 *           type: integer
 *           description: Monotonic order within the session.
 *         role:
 *           type: string
 *           enum: [system, user, assistant, tool]
 *         content:
 *           type: string
 *         client_turn_id:
 *           type: string
 *           nullable: true
 *         request_id:
 *           type: string
 *           nullable: true
 *         sender_type:
 *           type: string
 *           nullable: true
 *           enum: [user, llm, agent, system]
 *         sender_detail:
 *           type: string
 *           nullable: true
 *         attachment_ids:
 *           type: array
 *           nullable: true
 *           items:
 *             type: string
 *         attachments:
 *           type: array
 *           nullable: true
 *           items:
 *             $ref: '#/components/schemas/RuntimeMessageAttachment'
 *         tool_calls:
 *           type: string
 *           nullable: true
 *         tool_name:
 *           type: string
 *           nullable: true
 *         tool_call_id:
 *           type: string
 *           nullable: true
 *         cancelled:
 *           type: integer
 *           description: 0 or 1 (SQLite boolean).
 *         created_at:
 *           type: string
 *           format: date-time
 *       required: [id, session_id, order, role, content, created_at]
 *     RuntimeSessionMessagesResponse:
 *       type: object
 *       properties:
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/RuntimeSessionMessage'
 *         total:
 *           type: integer
 *         has_more:
 *           type: boolean
 *         session_version:
 *           type: integer
 *         cursor:
 *           type: integer
 *           nullable: true
 *       required: [messages, total, has_more, session_version]
 *     ChatRequest:
 *       type: object
 *       properties:
 *         mode:
 *           type: string
 *           enum: [chat, agent, claude-code-agent]
 *         session_id:
 *           type: string
 *         messages:
 *           type: array
 *           description: |
 *             Authoritative prompt history when multiple messages or any non-user
 *             message is provided. Single-message user requests fall back to the
 *             stored session transcript for backward compatibility.
 *           items:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [system, user, assistant, tool]
 *               content:
 *                 type: string
 *               attachment_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               client_turn_id:
 *                 type: string
 *             required: [role, content]
 *         model:
 *           type: string
 *         temperature:
 *           type: number
 *         max_tokens:
 *           type: integer
 *         client_turn_id:
 *           type: string
 *         assistant_client_turn_id:
 *           type: string
 *         expected_version:
 *           type: integer
 *           description: Optimistic concurrency — reject if session has been modified.
 *       required: [mode, session_id, messages]
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *       required: [error]
 *     ModelInfo:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         provider:
 *           type: string
 *         size:
 *           type: string
 *           nullable: true
 *         capabilities:
 *           type: array
 *           items:
 *             type: string
 *       required: [name, provider]
 *     HlvmConfig:
 *       type: object
 *       properties:
 *         model:
 *           type: string
 *           nullable: true
 *         temperature:
 *           type: number
 *           nullable: true
 *         maxTokens:
 *           type: integer
 *           nullable: true
 *         agentMode:
 *           type: string
 *           nullable: true
 *         sessionMemory:
 *           type: boolean
 *           nullable: true
 *     BindingFunction:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         kind:
 *           type: string
 *           enum: [def, defn]
 *         arity:
 *           type: integer
 *         signature:
 *           type: string
 *           nullable: true
 *       required: [name, kind, arity]
 */

export {};
