export const HTTP_STATUS = Object.freeze({
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  NOT_IMPLEMENTED: 501,
} as const);

export function isAuthStatus(status: number | undefined | null): boolean {
  return status === HTTP_STATUS.UNAUTHORIZED || status === HTTP_STATUS.FORBIDDEN;
}

export function isRateLimited(status: number | undefined | null): boolean {
  return status === HTTP_STATUS.TOO_MANY_REQUESTS;
}

export function isServerError(status: number | undefined | null): boolean {
  return typeof status === "number" && status >= 500 && status < 600;
}

export function isClientError(status: number | undefined | null): boolean {
  return typeof status === "number" && status >= 400 && status < 500;
}

export function isTransientStatus(status: number | undefined | null): boolean {
  return isServerError(status) ||
    status === HTTP_STATUS.REQUEST_TIMEOUT ||
    status === HTTP_STATUS.GATEWAY_TIMEOUT ||
    status === HTTP_STATUS.TOO_MANY_REQUESTS;
}
