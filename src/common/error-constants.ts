// Enhancements to src/common/error-constants.ts
// Adding better patterns and suggestions for function call errors

/**
 * Symbol used to mark errors as reported to prevent double-reporting
 * Shared across error.ts and runtime-error-handler.ts
 */
export const ERROR_REPORTED_SYMBOL = Symbol.for("__hql_error_reported__");
