/**
 * Agent Logger Facade — SDK-safe configurable logger
 *
 * Default: no-op (silent). HLVM wires in its real logger at startup via setAgentLogger().
 * SDK consumers can provide their own logger implementation.
 */

export interface AgentLogger {
  info(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

const noop = () => {};
let _logger: AgentLogger = { info: noop, error: noop, debug: noop, warn: noop };

export function setAgentLogger(logger: AgentLogger): void {
  _logger = logger;
}

export function getAgentLogger(): AgentLogger {
  return _logger;
}
