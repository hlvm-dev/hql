/**
 * AI Provider Abstraction Types
 *
 * Defines the contract all AI providers (Ollama, OpenAI, Anthropic, etc.) must implement.
 * This enables provider-agnostic AI operations throughout HQL.
 */

// ============================================================================
// Provider Capabilities
// ============================================================================

/** Capabilities a provider may support */
export type ProviderCapability =
  | "generate"
  | "chat"
  | "embeddings"
  | "models.list"
  | "models.catalog"
  | "models.pull"
  | "models.remove"
  | "vision";

// ============================================================================
// Message Types (Common across providers)
// ============================================================================

/** Role for chat messages */
export type MessageRole = "system" | "user" | "assistant";

/** A chat message */
export interface Message {
  role: MessageRole;
  content: string;
  /** Optional images for vision models (base64 or URLs) */
  images?: string[];
}

// ============================================================================
// Generation Options
// ============================================================================

/** Options for text generation */
export interface GenerateOptions {
  /** Model to use (defaults to provider's default) */
  model?: string;
  /** System prompt */
  system?: string;
  /** Temperature (0.0-2.0) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Stop sequences */
  stop?: string[];
  /** Format: json for structured output */
  format?: "json" | string;
  /** Stream output token by token */
  stream?: boolean;
  /** Images for vision models */
  images?: string[];
  /** Provider-specific options */
  raw?: Record<string, unknown>;
}

/** Options for chat completion */
export interface ChatOptions extends GenerateOptions {
  // Chat inherits all generate options
}

// ============================================================================
// Model Information
// ============================================================================

/** Information about an available model */
export interface ModelInfo {
  /** Model name/identifier */
  name: string;
  /** Display name */
  displayName?: string;
  /** Model size in bytes */
  size?: number;
  /** Model family (e.g., llama, gemma) */
  family?: string;
  /** Parameter count string (e.g., "7B", "70B") */
  parameterSize?: string;
  /** Quantization level (e.g., "Q4_0", "Q8_0") */
  quantization?: string;
  /** When the model was modified/updated */
  modifiedAt?: Date;
  /** Capabilities this model supports */
  capabilities?: ProviderCapability[];
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
  /** Link to model page (e.g., ollama.com/library/modelname) */
  link?: string;
}

// ============================================================================
// Capability Helpers
// ============================================================================

/** Boolean representation of model capabilities for UI convenience */
export interface ModelCapabilityFlags {
  completion: boolean;  // Text generation
  vision: boolean;      // Image understanding
  tools: boolean;       // Function calling
  embedding: boolean;   // Vector embeddings
  thinking: boolean;    // Reasoning/deliberation (e.g., deepseek-r1)
}

/**
 * Convert ProviderCapability array to boolean flags for UI
 * @param capabilities Array of capability strings
 * @returns Boolean flags for each capability
 */
export function capabilitiesToFlags(capabilities?: ProviderCapability[]): ModelCapabilityFlags {
  const caps = capabilities || [];
  return {
    completion: caps.includes("generate") || caps.includes("chat") || caps.length === 0,
    vision: caps.includes("vision"),
    tools: false, // Currently no "tools" capability in ProviderCapability
    embedding: caps.includes("embeddings"),
    thinking: false, // Currently no "thinking" capability in ProviderCapability
  };
}

/**
 * Format capabilities as display tags
 * Returns: "[text]", "[vision] [text]", "[text] [tools]", etc.
 * Follows Ollama library display order.
 */
export function formatCapabilityTags(capabilities?: ProviderCapability[]): string {
  const flags = capabilitiesToFlags(capabilities);
  const tags: string[] = [];

  // Order: vision, thinking, tools, text, embedding (following ollama.com/library)
  if (flags.vision) tags.push("[vision]");
  if (flags.thinking) tags.push("[thinking]");
  if (flags.tools) tags.push("[tools]");
  if (flags.completion) tags.push("[text]");
  if (flags.embedding) tags.push("[embed]");

  return tags.join(" ");
}

/** Progress info for model pull operations */
export interface PullProgress {
  /** Current status message */
  status: string;
  /** Digest being downloaded */
  digest?: string;
  /** Total size in bytes */
  total?: number;
  /** Completed size in bytes */
  completed?: number;
  /** Progress percentage (0-100) */
  percent?: number;
}

// ============================================================================
// Provider Status
// ============================================================================

/** Status of a provider */
export interface ProviderStatus {
  /** Whether the provider is available/connected */
  available: boolean;
  /** Provider version if available */
  version?: string;
  /** Error message if not available */
  error?: string;
  /** Endpoint URL */
  endpoint?: string;
  /** Additional status info */
  info?: Record<string, unknown>;
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * The core AI provider interface.
 * All providers (Ollama, OpenAI, Anthropic, etc.) implement this.
 */
export interface AIProvider {
  /** Provider name (e.g., "ollama", "openai") */
  readonly name: string;

  /** Provider display name (e.g., "Ollama", "OpenAI") */
  readonly displayName: string;

  /** Capabilities this provider supports */
  readonly capabilities: ProviderCapability[];

  /**
   * Generate text from a prompt (streaming)
   * @param prompt The input prompt
   * @param options Generation options
   * @yields Generated text chunks
   */
  generate(prompt: string, options?: GenerateOptions): AsyncGenerator<string, void, unknown>;

  /**
   * Chat completion with message history (streaming)
   * @param messages Array of messages
   * @param options Chat options
   * @yields Response text chunks
   */
  chat(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;

  /**
   * Model management operations (optional)
   */
  models?: {
    /** List available models */
    list(): Promise<ModelInfo[]>;
    /** Get info about a specific model */
    get(name: string): Promise<ModelInfo | null>;
    /** List catalog models (remote/curated) */
    catalog?(): Promise<ModelInfo[]>;
    /** Search catalog models */
    search?(query: string): Promise<ModelInfo[]>;
    /** Pull/download a model (streaming progress) */
    pull?(name: string, signal?: AbortSignal): AsyncGenerator<PullProgress, void, unknown>;
    /** Remove/delete a model */
    remove?(name: string): Promise<boolean>;
  };

  /**
   * Check provider status/connectivity
   */
  status(): Promise<ProviderStatus>;
}

// ============================================================================
// Provider Factory
// ============================================================================

/** Configuration for creating a provider instance */
export interface ProviderConfig {
  /** API key (for cloud providers) */
  apiKey?: string;
  /** Endpoint URL override */
  endpoint?: string;
  /** Default model */
  defaultModel?: string;
  /** Default options */
  defaults?: Partial<GenerateOptions>;
}

/** Factory function type for creating provider instances */
export type ProviderFactory = (config?: ProviderConfig) => AIProvider;

// ============================================================================
// Registry Types
// ============================================================================

/** Registered provider entry */
export interface RegisteredProvider {
  /** Provider factory function */
  factory: ProviderFactory;
  /** Default configuration */
  defaultConfig?: ProviderConfig;
  /** Whether this is the default provider */
  isDefault?: boolean;
}
