// @hlvm/media - Media handling for AI functions
// Provides unified media abstraction for images, audio, video
// Future-proof design for vision models and multimodal AI

// ============================================================
// Media Types - extensible for future media types
// ============================================================

export const MediaType = {
  IMAGE: "image",
  AUDIO: "audio",
  VIDEO: "video",
  DOCUMENT: "document"
};

function __getRuntime() {
  const runtime = globalThis.runtime;
  return runtime && typeof runtime === "object" ? runtime : null;
}

// ============================================================
// Media Object - core data structure
// ============================================================

/**
 * Create a Media object
 * @param {string} type - Media type (image, audio, video, document)
 * @param {string} mimeType - MIME type (e.g., "image/png")
 * @param {string} base64Data - Base64-encoded content
 * @param {string|null} source - Original source path/URL
 * @returns {Media} Media object with __hlvm_media__ tag
 */
export function createMedia(type, mimeType, base64Data, source = null) {
  return {
    type,
    mimeType,
    data: base64Data,
    source,
    __hlvm_media__: true
  };
}

/**
 * Check if value is a Media object
 * @param {any} value - Value to check
 * @returns {boolean} True if value is a Media object
 */
export function isMedia(value) {
  return value != null && value.__hlvm_media__ === true;
}

// ============================================================
// Path Resolution
// ============================================================

function resolvePath(path) {
  const host = globalThis.hlvm;
  if (!host) return path;

  // Handle ~ home directory
  if (path.startsWith("~")) {
    const home = host.env.get("HOME") || "";
    return path.replace(/^~/, home);
  }

  // Absolute paths stay as-is
  if (path.startsWith("/")) return path;

  // Relative paths resolve from cwd
  return `${host.fs.cwd()}/${path}`;
}

// ============================================================
// MIME Type Detection
// ============================================================

const EXT_TO_MIME = {
  // Images
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".ico": "image/x-icon",
  ".heic": "image/heic",
  ".heif": "image/heif",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  // Documents
  ".pdf": "application/pdf"
};

function detectMime(path) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

function mimeToType(mime) {
  if (mime.startsWith("image/")) return MediaType.IMAGE;
  if (mime.startsWith("audio/")) return MediaType.AUDIO;
  if (mime.startsWith("video/")) return MediaType.VIDEO;
  if (mime === "application/pdf") return MediaType.DOCUMENT;
  return MediaType.DOCUMENT;
}

// ============================================================
// Helper Functions - User-friendly media loading
// ============================================================

/**
 * Read an image file and return a Media object
 * HQL: (read-image "./photo.jpg")
 * @param {string} path - Path to image file
 * @returns {Promise<Media>} Media object with base64-encoded image
 */
export async function readImage(path) {
  const resolved = resolvePath(path);
  const mime = detectMime(resolved);

  // Validate it's an image
  if (!mime.startsWith("image/")) {
    throw new Error(`Not an image file: ${path} (detected: ${mime})`);
  }

  const host = globalThis.hlvm;
  if (!host) throw new Error("hlvm global not available");
  const bytes = await host.fs.readFile(resolved);
  const base64 = bytesToBase64(bytes);
  return createMedia(MediaType.IMAGE, mime, base64, path);
}

/**
 * Read any media file and return a Media object
 * HQL: (read-media "./file.mp4")
 * @param {string} path - Path to media file
 * @returns {Promise<Media>} Media object with base64-encoded content
 */
export async function readMedia(path) {
  const resolved = resolvePath(path);
  const mime = detectMime(resolved);
  const type = mimeToType(mime);
  const host = globalThis.hlvm;
  if (!host) throw new Error("hlvm global not available");
  const bytes = await host.fs.readFile(resolved);
  const base64 = bytesToBase64(bytes);
  return createMedia(type, mime, base64, path);
}

/**
 * Create Media from raw base64 data
 * HQL: (media-from-base64 "image/png" base64-string)
 * @param {string} mimeType - MIME type of the data
 * @param {string} base64Data - Base64-encoded content
 * @returns {Media} Media object
 */
export function mediaFromBase64(mimeType, base64Data) {
  const type = mimeToType(mimeType);
  return createMedia(type, mimeType, base64Data);
}

/**
 * Fetch media from URL and return a Media object
 * HQL: (read-media-url "https://example.com/image.jpg")
 * @param {string} url - URL to fetch media from
 * @returns {Promise<Media>} Media object with base64-encoded content
 */
export async function readMediaUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
  }

  // Get content type from response or guess from URL
  let contentType = response.headers.get("content-type");
  if (contentType) {
    contentType = contentType.split(";")[0].trim();
  } else {
    contentType = detectMime(url);
  }

  const type = mimeToType(contentType);
  const buffer = await response.arrayBuffer();
  const base64 = bytesToBase64(new Uint8Array(buffer));

  return createMedia(type, contentType, base64, url);
}

// ============================================================
// Base64 Encoding
// ============================================================

/**
 * Convert Uint8Array to base64 string
 * Uses chunked approach to avoid call stack limits
 */
function bytesToBase64(bytes) {
  // For small files, use simple approach
  if (bytes.length < 32768) {
    return btoa(String.fromCharCode(...bytes));
  }

  // For large files, chunk to avoid call stack overflow
  const chunks = [];
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

// ============================================================
// Media Extraction Helpers (for AI functions)
// ============================================================

/**
 * Extract Media objects from various input formats
 * Handles: single Media, array of Media, options.media
 * @param {any[]} args - Function arguments
 * @param {Object} options - Options object
 * @returns {Media[]} Array of Media objects
 */
export function extractMedia(args, options) {
  const result = [];

  // Check args for Media objects
  for (const arg of args) {
    if (isMedia(arg)) {
      result.push(arg);
    } else if (Array.isArray(arg)) {
      for (const item of arg) {
        if (isMedia(item)) result.push(item);
      }
    }
  }

  // Check options.media
  if (options && options.media !== undefined) {
    if (Array.isArray(options.media)) {
      for (const item of options.media) {
        if (isMedia(item)) result.push(item);
      }
    } else if (isMedia(options.media)) {
      result.push(options.media);
    }
  }

  return result;
}

/**
 * Get images for Ollama API (base64 strings only)
 * @param {Object} options - Options object with potential media
 * @returns {string[]} Array of base64-encoded image strings
 */
export function getImagesForOllama(options) {
  // Explicit media in options
  if (options && options.media !== undefined) {
    // Empty array or null = explicit no media
    if (options.media === null) return [];
    if (Array.isArray(options.media) && options.media.length === 0) return [];

    const mediaList = Array.isArray(options.media) ? options.media : [options.media];
    return mediaList
      .filter(m => isMedia(m) && m.type === MediaType.IMAGE)
      .map(m => m.data);
  }

  // Auto-include from runtime media
  const runtime = __getRuntime();
  const attachments = runtime ? runtime.media : [];
  return attachments
    .filter(m => isMedia(m) && m.type === MediaType.IMAGE)
    .map(m => m.data);
}

// ============================================================
// Exports
// ============================================================

export default {
  MediaType,
  createMedia,
  isMedia,
  readImage,
  readMedia,
  readMediaUrl,
  mediaFromBase64,
  extractMedia,
  getImagesForOllama
};
