import { globalLogger as logger } from "../../../logger.ts";

export enum ErrorType {
  AUTHORIZATION = "authorization",
  NETWORK = "network",
  NOT_FOUND = "not_found",
  VERSION_CONFLICT = "version_conflict",
  PERMISSIONS = "permissions",
  INSTALLATION = "installation",
  VALIDATION = "validation",
  RATE_LIMIT = "rate_limit",
  DEPENDENCY = "dependency",
  CONFIGURATION = "configuration",
  DISK_SPACE = "disk_space",
  TIMEOUT = "timeout",
  SERVER = "server",
  USER_DENIAL = "user_denial",
  UNKNOWN = "unknown",
}

export interface ErrorInfo {
  type: ErrorType;
  message: string;
  originalError?: string;
  registry: "npm" | "jsr";
}

const errorPatterns = {
  jsr: [
    {
      type: ErrorType.USER_DENIAL,
      patterns: [
        "Attention: Authorization has been denied",
        "authorization denied by user",
        "user denied authorization",
        "Authorization was denied in web prompt",
        "denied by the user in web prompt",
        "denied authorization in the browser",
        "authorization has been denied by the user",
        "Authentication was denied by the user",
        "web prompt was dismissed",
        "web prompt was closed",
        "web prompt was canceled",
        "browser authentication was canceled",
        "Checking for slow types",
        "authorization was canceled in browser",
      ],
    },
    {
      type: ErrorType.AUTHORIZATION,
      patterns: [
        "authorization has been denied",
        "authorizationDenied",
        "Failed to exchange authorization",
        "authentication required",
        "login required",
        "not authenticated",
        "invalid token",
        "token expired",
        "access token expired",
        "no active login session",
        "authentication failure",
        "session timeout",
      ],
    },
    {
      type: ErrorType.NETWORK,
      patterns: [
        "network error",
        "failed to fetch",
        "timeout",
        "socket hang up",
        "connection refused",
        "connection reset",
        "cannot reach",
        "unreachable host",
        "host unreachable",
        "network unreachable",
        "connection timeout",
        "connection closed",
        "TLS handshake failed",
        "certificate verification failed",
      ],
    },
    {
      type: ErrorType.VERSION_CONFLICT,
      patterns: [
        "version already exists",
        "version is already published",
        "cannot replace existing version",
        "duplicate version",
        "already been published",
        "tag already exists",
        "package@version already exists",
        "module version conflict",
      ],
    },
    {
      type: ErrorType.NOT_FOUND,
      patterns: [
        "not found",
        "404",
        "resource not found",
        "package does not exist",
        "could not find",
        "no such package",
        "no such module",
        "does not exist",
      ],
    },
    {
      type: ErrorType.PERMISSIONS,
      patterns: [
        "permission denied",
        "forbidden",
        "403",
        "access denied",
        "insufficient privileges",
        "not authorized to publish",
        "unauthorized access",
        "you do not have permission",
        "this package is protected",
        "you do not have access",
      ],
    },
    {
      type: ErrorType.INSTALLATION,
      patterns: [
        "not installed or available",
        "Command not found",
        "deno not found",
        "jsr not found",
        "binary not found",
        "executable not found",
        "command not available",
      ],
    },
    {
      type: ErrorType.VALIDATION,
      patterns: [
        "invalid package",
        "invalid module",
        "invalid export",
        "validation failed",
        "schema validation",
        "jsr.json is invalid",
        "invalid format",
        "malformed json",
        "incorrect format",
        "syntax error in",
      ],
    },
    {
      type: ErrorType.RATE_LIMIT,
      patterns: [
        "rate limit",
        "too many requests",
        "429",
        "request quota exceeded",
        "throttled",
        "please slow down",
        "too many attempts",
      ],
    },
    {
      type: ErrorType.DEPENDENCY,
      patterns: [
        "dependency not found",
        "unresolved dependency",
        "missing dependency",
        "incompatible dependency",
        "dependency version conflict",
        "peer dependency",
        "circular dependency",
      ],
    },
    {
      type: ErrorType.CONFIGURATION,
      patterns: [
        "missing configuration",
        "invalid configuration",
        "missing jsr.json",
        "config error",
        "missing required field",
        "required field missing",
      ],
    },
    {
      type: ErrorType.SERVER,
      patterns: [
        "server error",
        "internal server error",
        "500",
        "service unavailable",
        "503",
        "jsr service is down",
        "maintenance",
        "jsr io is currently unavailable",
        "backend failure",
      ],
    },
    {
      type: ErrorType.TIMEOUT,
      patterns: [
        "request timeout",
        "operation timed out",
        "deadline exceeded",
        "took too long",
        "timed out waiting for",
      ],
    },
  ],
  npm: [
    {
      type: ErrorType.USER_DENIAL,
      patterns: [
        "cancelled by user",
        "canceled by user",
        "operation cancelled",
        "operation canceled",
        "user aborted",
        "prompt dismissed",
        "authentication cancelled",
        "authentication canceled",
        "operation aborted by user",
        "user rejected authentication",
        "user declined",
      ],
    },
    {
      type: ErrorType.AUTHORIZATION,
      patterns: [
        "unauthorized",
        "not authorized",
        "auth required",
        "auth error",
        "not logged in",
        "ENEEDAUTH",
        "401",
        "who am i",
        "npm whoami",
        "token is invalid",
        "invalid credentials",
        "username/password incorrect",
        "invalid token",
        "login required",
        "authentication failed",
        "auth token expired",
      ],
    },
    {
      type: ErrorType.NETWORK,
      patterns: [
        "network error",
        "ETIMEDOUT",
        "ENOTFOUND",
        "ECONNREFUSED",
        "ECONNRESET",
        "ESOCKETTIMEDOUT",
        "ENETUNREACH",
        "EHOSTUNREACH",
        "socket hang up",
        "getaddrinfo ENOTFOUND",
        "fetch failed",
        "unable to connect",
        "could not connect to registry",
        "connect ECONNREFUSED",
        "network timeout",
        "TLS error",
        "SSL error",
        "certificate has expired",
        "self-signed certificate",
      ],
    },
    {
      type: ErrorType.VERSION_CONFLICT,
      patterns: [
        "version already exists",
        "cannot publish over the previously published version",
        "EPUBLISHCONFLICT",
        "cannot publish over existing version",
        "cannot publish same version",
        "version exists",
        "already published",
        "You cannot publish over the previously published versions",
        "conflicting version",
        "duplicate version",
      ],
    },
    {
      type: ErrorType.NOT_FOUND,
      patterns: [
        "not found",
        "404",
        "no such package",
        "ENOENT",
        "ETARGET",
        "ENOTFOUND",
        "Not found: could not find package",
        "no such file or directory",
        "package not found",
        "no such package available",
        "does not exist",
      ],
    },
    {
      type: ErrorType.PERMISSIONS,
      patterns: [
        "permission denied",
        "forbidden",
        "403",
        "do not have permission",
        "EACCES",
        "EPERM",
        "ENOACCESS",
        "you do not have permission",
        "access denied",
        "insufficient privileges",
        "you do not have access to publish",
        "not allowed to publish",
        "private package",
        "access restricted",
      ],
    },
    {
      type: ErrorType.INSTALLATION,
      patterns: [
        "npm not installed",
        "command not found",
        "not found: npm",
        "npm: command not found",
        "ENOENT: npm",
        "spawn npm ENOENT",
        "executable not found",
      ],
    },
    {
      type: ErrorType.VALIDATION,
      patterns: [
        "EPACKAGEJSON",
        "EJSONPARSE",
        "EISGIT",
        "ERR! Please try running this command again as root/Administrator",
        "invalid package name",
        "invalid version",
        "invalid semver",
        "name can no longer contain",
        "name can only contain",
        "package.json is not valid JSON",
        "package.json must be actual JSON",
        "malformed package.json",
        "Invalid name",
        "Invalid version",
      ],
    },
    {
      type: ErrorType.RATE_LIMIT,
      patterns: [
        "rate limit",
        "too many requests",
        "429",
        "ETOOMANYREQ",
        "ETOOMANYREQS",
        "npm ERR! code E429",
        "you have exceeded your request limit",
        "too many operations",
        "retry after",
        "request quota exceeded",
        "throttled",
      ],
    },
    {
      type: ErrorType.DEPENDENCY,
      patterns: [
        "ERESOLVE",
        "ENODEPS",
        "EDEPENDENCY",
        "peer dependency",
        "required dependency",
        "missing dependency",
        "unmet dependency",
        "dependency tree",
        "missing peer dependency",
        "conflicting dependency",
        "dependency conflict",
        "cyclic dependency",
        "could not resolve dependency",
      ],
    },
    {
      type: ErrorType.CONFIGURATION,
      patterns: [
        "EMISSINGARG",
        "EWORKSPACE",
        "EUSAGE",
        "missing script",
        "missing npmrc",
        "invalid config",
        "configuration error",
        "config not found",
        "registry not specified",
        "missing required field",
        "missing .npmrc",
      ],
    },
    {
      type: ErrorType.DISK_SPACE,
      patterns: [
        "ENOSPC",
        "no space left on device",
        "out of disk space",
        "insufficient space",
        "disk quota exceeded",
        "write error: no space",
        "not enough space",
        "disk full",
      ],
    },
    {
      type: ErrorType.TIMEOUT,
      patterns: [
        "ETIMEOUT",
        "timed out",
        "timeout exceeded",
        "operation timed out",
        "request timed out",
        "wait timed out",
        "exceeded timeout",
        "operation took too long",
      ],
    },
    {
      type: ErrorType.SERVER,
      patterns: [
        "EPROTO",
        "EINTERNAL",
        "E500",
        "E503",
        "registry error",
        "internal server error",
        "service unavailable",
        "server error",
        "registry returned 500",
        "registry returned 502",
        "registry returned 503",
        "registry is down",
        "registry not responding",
        "registry maintenance",
        "npm registry appears to be down",
      ],
    },
  ],
};

function getUserErrorMessage(type: ErrorType, registry: "npm" | "jsr"): string {
  const prefix = `❌ ${registry.toUpperCase()} publish failed: `;

  const messages = {
    [ErrorType.USER_DENIAL]: {
      jsr:
        `${prefix}Authentication was denied by the user in the web prompt. Please complete the authentication process in the browser window.`,
      npm:
        `${prefix}Authentication process was canceled by the user. Please run npm login and try again.`,
    },
    [ErrorType.AUTHORIZATION]: {
      jsr:
        `${prefix}Authorization failed. Please run 'deno login' or 'jsr login' and try again.`,
      npm:
        `${prefix}Authentication failed. Please ensure you are logged in to npm (run: npm login).`,
    },
    [ErrorType.NETWORK]:
      `${prefix}Network error encountered. Please check your internet connection and try again.`,
    [ErrorType.VERSION_CONFLICT]:
      `${prefix}Version already exists. Try incrementing the version number or use a different version.`,
    [ErrorType.NOT_FOUND]:
      `${prefix}Package or resource not found. Please check the package name and path.`,
    [ErrorType.PERMISSIONS]:
      `${prefix}Insufficient permissions to publish this package. Please verify you have the correct access rights.`,
    [ErrorType.INSTALLATION]: {
      jsr:
        `${prefix}Neither jsr nor deno is installed or available. Please install jsr (https://jsr.io/cli) or deno (https://deno.com/) to publish to JSR.`,
      npm:
        `${prefix}npm command not found. Please ensure npm is installed and available in your PATH.`,
    },
    [ErrorType.VALIDATION]:
      `${prefix}Package validation failed. Please check your package configuration for errors.`,
    [ErrorType.RATE_LIMIT]:
      `${prefix}Rate limit exceeded. Please wait a few minutes before trying again.`,
    [ErrorType.DEPENDENCY]:
      `${prefix}Dependency resolution failed. Please check your package dependencies and ensure they are available.`,
    [ErrorType.CONFIGURATION]:
      `${prefix}Configuration error detected. Please check your ${
        registry === "jsr" ? "jsr.json" : "package.json"
      } file for issues.`,
    [ErrorType.DISK_SPACE]:
      `${prefix}Insufficient disk space. Please free up some space and try again.`,
    [ErrorType.TIMEOUT]:
      `${prefix}Operation timed out. Please check your network connection and try again.`,
    [ErrorType.SERVER]:
      `${prefix}Server error encountered. The ${registry} registry might be experiencing issues. Please try again later.`,
    [ErrorType.UNKNOWN]:
      `${prefix}An unknown error occurred. Please check the log for more details.`,
  };

  const message = messages[type];
  if (typeof message === "string") {
    return message;
  }
  return message[registry];
}

function detectError(errorMessage: string, registry: "npm" | "jsr"): ErrorInfo {
  logger.debug &&
    logger.debug(
      `[${registry.toUpperCase()} error] Raw error: ${errorMessage}`,
    );

  const patterns = errorPatterns[registry];

  for (const { type, patterns: typePatterns } of patterns) {
    if (
      typePatterns.some((pattern) =>
        errorMessage.toLowerCase().includes(pattern.toLowerCase())
      )
    ) {
      return {
        type,
        message: getUserErrorMessage(type, registry),
        originalError: errorMessage,
        registry,
      };
    }
  }

  if (
    registry === "jsr" &&
    (errorMessage.includes("Checking for slow types") ||
      errorMessage.includes("authorization denied"))
  ) {
    return {
      type: ErrorType.USER_DENIAL,
      message: getUserErrorMessage(ErrorType.USER_DENIAL, registry),
      originalError: errorMessage,
      registry,
    };
  }

  return {
    type: ErrorType.UNKNOWN,
    message: `❌ ${registry.toUpperCase()} publish failed: ${errorMessage}`,
    originalError: errorMessage,
    registry,
  };
}

export function detectNpmError(errorMessage: string): ErrorInfo {
  return detectError(errorMessage, "npm");
}
