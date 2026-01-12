; @hql/media - Media Handling for Vision Models
; Usage: (import [read-image read-media] from "@hql/media")
;
; Provides functions to load media files for use with vision-capable AI models.
; Media objects can be passed to AI functions via the {media: ...} option.
;
; Example:
;   (import [ask] from "@hql/ai")
;   (import [read-image] from "@hql/media")
;   (ask "What's in this image?" {media: (read-image "./photo.jpg")})

; ============================================================================
; Media Types
; ============================================================================

(def MediaType {
  "IMAGE": "image"
  "AUDIO": "audio"
  "VIDEO": "video"
  "DOCUMENT": "document"
})

; ============================================================================
; Media Object Creation
; ============================================================================

; Create a media object from components
(fn create-media [type mime-type base64-data source]
  {
    "type": type
    "mimeType": mime-type
    "data": base64-data
    "source": (or source nil)
    "__hql_media__": true
  })

; Check if value is a media object
(fn media? [value]
  (and (not (nil? value))
       (=== (js-get value "__hql_media__") true)))

; ============================================================================
; Path Resolution
; ============================================================================

(fn resolve-path [path]
  (cond
    ; Handle ~ home directory
    (path.startsWith "~")
    (let home (or (when (isDefined js/Deno) (js/Deno.env.get "HOME")) ""))
    (path.replace "~" home)

    ; Absolute paths stay as-is
    (path.startsWith "/")
    path

    ; Relative paths resolve from cwd
    true
    (str (when (isDefined js/Deno) (js/Deno.cwd) ".") "/" path)))

; ============================================================================
; MIME Type Detection
; ============================================================================

(def EXT_TO_MIME {
  ; Images
  ".jpg": "image/jpeg"
  ".jpeg": "image/jpeg"
  ".png": "image/png"
  ".gif": "image/gif"
  ".webp": "image/webp"
  ".svg": "image/svg+xml"
  ".bmp": "image/bmp"
  ".heic": "image/heic"
  ".heif": "image/heif"
  ; Audio
  ".mp3": "audio/mpeg"
  ".wav": "audio/wav"
  ".ogg": "audio/ogg"
  ; Video
  ".mp4": "video/mp4"
  ".webm": "video/webm"
  ".mov": "video/quicktime"
  ; Documents
  ".pdf": "application/pdf"
})

(fn detect-mime [path]
  (let ext (.toLowerCase (path.slice (path.lastIndexOf "."))))
  (or (js-get EXT_TO_MIME ext) "application/octet-stream"))

(fn mime-to-type [mime]
  (cond
    (mime.startsWith "image/") MediaType.IMAGE
    (mime.startsWith "audio/") MediaType.AUDIO
    (mime.startsWith "video/") MediaType.VIDEO
    (=== mime "application/pdf") MediaType.DOCUMENT
    true MediaType.DOCUMENT))

; ============================================================================
; Base64 Encoding
; ============================================================================

; Convert Uint8Array to base64 string (chunked for large files)
(fn bytes-to-base64 [bytes]
  (if (< bytes.length 32768)
      ; Small files - simple approach
      (js/btoa (js/String.fromCharCode.apply nil bytes))
      ; Large files - chunk to avoid stack overflow
      (do
        (var chunks [])
        (var i 0)
        (let chunk-size 32768)
        (while (< i bytes.length)
          (let chunk (bytes.slice i (+ i chunk-size)))
          (chunks.push (js/String.fromCharCode.apply nil chunk))
          (= i (+ i chunk-size)))
        (js/btoa (chunks.join "")))))

; ============================================================================
; Public API - Media Loading Functions
; ============================================================================

; Read an image file and return a Media object
; (read-image "./photo.jpg") -> Media
(async fn read-image [path]
  "Read an image file and return a Media object for vision models"
  (let resolved (resolve-path path))
  (let mime (detect-mime resolved))

  ; Validate it's an image
  (when (not (mime.startsWith "image/"))
    (throw (new js/Error (str "Not an image file: " path " (detected: " mime ")"))))

  (let bytes (await (js/Deno.readFile resolved)))
  (let base64 (bytes-to-base64 bytes))
  (create-media MediaType.IMAGE mime base64 path))

; Read any media file and return a Media object
; (read-media "./file.mp4") -> Media
(async fn read-media [path]
  "Read any media file and return a Media object"
  (let resolved (resolve-path path))
  (let mime (detect-mime resolved))
  (let type (mime-to-type mime))
  (let bytes (await (js/Deno.readFile resolved)))
  (let base64 (bytes-to-base64 bytes))
  (create-media type mime base64 path))

; Create Media from raw base64 data
; (media-from-base64 "image/png" "iVBORw0...") -> Media
(fn media-from-base64 [mime-type base64-data]
  "Create a Media object from raw base64 data"
  (let type (mime-to-type mime-type))
  (create-media type mime-type base64-data nil))

; Fetch media from URL and return a Media object
; (read-media-url "https://example.com/image.jpg") -> Media
(async fn read-media-url [url]
  "Fetch media from a URL and return a Media object"
  (let response (await (js/fetch url)))
  (when (not response.ok)
    (throw (new js/Error (str "Failed to fetch media: " response.status " " response.statusText))))

  ; Get content type from response or guess from URL
  (let content-type-header (response.headers.get "content-type"))
  (let content-type (if content-type-header
                        (.trim ((content-type-header.split ";").at 0))
                        (detect-mime url)))

  (let type (mime-to-type content-type))
  (let buffer (await (response.arrayBuffer)))
  (let base64 (bytes-to-base64 (new js/Uint8Array buffer)))

  (create-media type content-type base64 url))

; ============================================================================
; Exports
; ============================================================================

(export [
  MediaType
  create-media
  media?
  read-image
  read-media
  read-media-url
  media-from-base64
])
