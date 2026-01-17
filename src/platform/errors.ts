/**
 * Platform Error Types
 *
 * This file defines platform-agnostic error types that wrap runtime-specific errors.
 * Use PlatformError instead of checking for Deno.errors.* directly.
 */

// =============================================================================
// Error Codes
// =============================================================================

export enum PlatformErrorCode {
  NotFound = "ENOENT",
  AlreadyExists = "EEXIST",
  PermissionDenied = "EACCES",
  IsDirectory = "EISDIR",
  NotDirectory = "ENOTDIR",
  InvalidData = "EINVAL",
  TimedOut = "ETIMEDOUT",
  ConnectionRefused = "ECONNREFUSED",
  AddrInUse = "EADDRINUSE",
  BrokenPipe = "EPIPE",
  Interrupted = "EINTR",
  Unknown = "EUNKNOWN",
}

// =============================================================================
// PlatformError Class
// =============================================================================

/**
 * Platform-agnostic error class that wraps runtime-specific errors.
 *
 * Use the static type guard methods (isNotFound, isAlreadyExists, etc.)
 * instead of instanceof checks on runtime-specific error types.
 */
export class PlatformError extends Error {
  public override readonly name = "PlatformError";

  constructor(
    message: string,
    public readonly code: PlatformErrorCode,
    cause?: Error,
  ) {
    super(message, { cause });
    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PlatformError);
    }
  }

  // ===========================================================================
  // Type Guards
  // ===========================================================================

  static isNotFound(error: unknown): error is PlatformError {
    return error instanceof PlatformError &&
      error.code === PlatformErrorCode.NotFound;
  }

  static isAlreadyExists(error: unknown): error is PlatformError {
    return error instanceof PlatformError &&
      error.code === PlatformErrorCode.AlreadyExists;
  }

  static isPermissionDenied(error: unknown): error is PlatformError {
    return error instanceof PlatformError &&
      error.code === PlatformErrorCode.PermissionDenied;
  }

  static isIsDirectory(error: unknown): error is PlatformError {
    return error instanceof PlatformError &&
      error.code === PlatformErrorCode.IsDirectory;
  }

  static isNotDirectory(error: unknown): error is PlatformError {
    return error instanceof PlatformError &&
      error.code === PlatformErrorCode.NotDirectory;
  }

  static isTimedOut(error: unknown): error is PlatformError {
    return error instanceof PlatformError &&
      error.code === PlatformErrorCode.TimedOut;
  }

  static isConnectionRefused(error: unknown): error is PlatformError {
    return error instanceof PlatformError &&
      error.code === PlatformErrorCode.ConnectionRefused;
  }

  // ===========================================================================
  // Factory Methods
  // ===========================================================================

  /**
   * Wraps a Deno error into a PlatformError.
   * Unknown errors are re-thrown as-is.
   */
  static fromDenoError(error: Error): PlatformError {
    // Map Deno error names to PlatformErrorCode
    const errorMap: Record<string, PlatformErrorCode> = {
      NotFound: PlatformErrorCode.NotFound,
      AlreadyExists: PlatformErrorCode.AlreadyExists,
      PermissionDenied: PlatformErrorCode.PermissionDenied,
      IsADirectory: PlatformErrorCode.IsDirectory,
      NotADirectory: PlatformErrorCode.NotDirectory,
      InvalidData: PlatformErrorCode.InvalidData,
      TimedOut: PlatformErrorCode.TimedOut,
      ConnectionRefused: PlatformErrorCode.ConnectionRefused,
      AddrInUse: PlatformErrorCode.AddrInUse,
      BrokenPipe: PlatformErrorCode.BrokenPipe,
      Interrupted: PlatformErrorCode.Interrupted,
    };

    const code = errorMap[error.name];
    if (code) {
      return new PlatformError(error.message, code, error);
    }

    // Re-throw unknown errors
    throw error;
  }

  /**
   * Wraps an error if it's a known platform error, otherwise re-throws.
   * Use this in catch blocks to convert runtime errors.
   */
  static wrap(error: unknown): PlatformError {
    if (error instanceof PlatformError) {
      return error;
    }
    if (error instanceof Error) {
      return PlatformError.fromDenoError(error);
    }
    throw error;
  }

  /**
   * Creates a NotFound error.
   */
  static notFound(path: string): PlatformError {
    return new PlatformError(
      `No such file or directory: ${path}`,
      PlatformErrorCode.NotFound,
    );
  }

  /**
   * Creates an AlreadyExists error.
   */
  static alreadyExists(path: string): PlatformError {
    return new PlatformError(
      `File already exists: ${path}`,
      PlatformErrorCode.AlreadyExists,
    );
  }

  /**
   * Creates a PermissionDenied error.
   */
  static permissionDenied(path: string): PlatformError {
    return new PlatformError(
      `Permission denied: ${path}`,
      PlatformErrorCode.PermissionDenied,
    );
  }
}
