/**
 * Structured logging port used by application services. Pino (and therefore Fastify's logger)
 * satisfies it, and tests can pass a silent fake.
 */
export interface Logger {
  debug(context: object, message?: string): void;
  info(context: object, message?: string): void;
  warn(context: object, message?: string): void;
  error(context: object, message?: string): void;
}

export const SILENT_LOGGER: Logger = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
