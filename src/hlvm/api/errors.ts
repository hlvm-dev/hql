/**
 * Errors API - SSOT for error creation and type checking
 *
 * This module provides a factory interface for creating typed HQL errors.
 * All error creation should ideally go through this API for consistency.
 *
 * SSOT: This is registered on globalThis.errors for REPL access.
 *
 * @see docs/SSOT-CONTRACT.md for error handling guidelines
 */

import {
  HQLError,
  ParseError,
  ImportError,
  ValidationError,
  MacroError,
  TransformError,
  RuntimeError,
  CodeGenError,
  type SourceLocation,
  reportError,
  formatHQLError,
} from "../../common/error.ts";

/**
 * Error factory API interface
 */
export interface ErrorsApi {
  // Factory methods for creating typed errors
  parse(message: string, location: {
    line: number;
    column: number;
    filePath?: string;
    source?: string;
  }): ParseError;

  import(message: string, importPath?: string, location?: SourceLocation): ImportError;

  validation(message: string, context: string, location?: SourceLocation): ValidationError;

  macro(message: string, macroName: string, location?: SourceLocation): MacroError;

  transform(message: string, phase?: string, location?: SourceLocation): TransformError;

  runtime(message: string, location?: SourceLocation): RuntimeError;

  codeGen(message: string, nodeType?: string, location?: SourceLocation): CodeGenError;

  generic(message: string, location?: SourceLocation): HQLError;

  // Error type checking utilities
  isHQLError(error: unknown): error is HQLError;
  isParseError(error: unknown): error is ParseError;
  isImportError(error: unknown): error is ImportError;
  isValidationError(error: unknown): error is ValidationError;
  isMacroError(error: unknown): error is MacroError;
  isTransformError(error: unknown): error is TransformError;
  isRuntimeError(error: unknown): error is RuntimeError;
  isCodeGenError(error: unknown): error is CodeGenError;

  // Error reporting utilities
  report(error: Error | HQLError, isDebug?: boolean): Promise<void>;
  format(error: HQLError, isDebug?: boolean): Promise<string>;
}

/**
 * Errors API implementation
 */
export const errors: ErrorsApi = {
  // Factory methods
  parse(message, location) {
    return new ParseError(message, location);
  },

  import(message, importPath?, location?) {
    if (importPath && location) {
      return new ImportError(message, importPath, location);
    } else if (importPath) {
      return new ImportError(message, importPath);
    } else {
      return new ImportError(message);
    }
  },

  validation(message, context, location?) {
    if (location) {
      return new ValidationError(message, context, location);
    }
    return new ValidationError(message, context);
  },

  macro(message, macroName, location?) {
    if (location) {
      return new MacroError(message, macroName, location);
    }
    return new MacroError(message, macroName);
  },

  transform(message, phase?, location?) {
    if (phase && location) {
      return new TransformError(message, phase, location);
    } else if (phase) {
      return new TransformError(message, phase);
    }
    return new TransformError(message);
  },

  runtime(message, location?) {
    return new RuntimeError(message, location ?? {});
  },

  codeGen(message, nodeType?, location?) {
    if (nodeType && location) {
      return new CodeGenError(message, { nodeType, ...location });
    } else if (nodeType) {
      return new CodeGenError(message, nodeType);
    }
    return new CodeGenError(message);
  },

  generic(message, location?) {
    return new HQLError(message, { sourceLocation: location });
  },

  // Type checking utilities
  isHQLError(error): error is HQLError {
    return error instanceof HQLError;
  },

  isParseError(error): error is ParseError {
    return error instanceof ParseError;
  },

  isImportError(error): error is ImportError {
    return error instanceof ImportError;
  },

  isValidationError(error): error is ValidationError {
    return error instanceof ValidationError;
  },

  isMacroError(error): error is MacroError {
    return error instanceof MacroError;
  },

  isTransformError(error): error is TransformError {
    return error instanceof TransformError;
  },

  isRuntimeError(error): error is RuntimeError {
    return error instanceof RuntimeError;
  },

  isCodeGenError(error): error is CodeGenError {
    return error instanceof CodeGenError;
  },

  // Reporting utilities
  async report(error, isDebug = false) {
    await reportError(error, isDebug);
  },

  async format(error, isDebug = false) {
    return await formatHQLError(error, isDebug);
  },
};

export default errors;
