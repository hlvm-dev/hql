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
 *         image_paths:
 *           type: string
 *           nullable: true
 *           description: JSON array of image file paths.
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
 *           items:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [system, user, assistant, tool]
 *               content:
 *                 type: string
 *               image_paths:
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
 *     MemoryFunction:
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
