import type { FastifyReply } from 'fastify';
import { z } from 'zod';

/**
 * Shared request schemas and error answers of the authenticated panel API (`/api/panel`). Errors
 * are `{ error: <snake_case code>, message }`; validation errors add `details`.
 */

/** Public codes of routes, points and vehicles, normalized to upper case. */
export const codeSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,16}$/)
  .transform((code) => code.toUpperCase());

/** A calendar date (`YYYY-MM-DD`); panel dates are local to the pilot (America/Lima). */
export const localDateSchema = z.iso.date();

/** A local time of day (`HH:MM`, 24 h). */
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

export const uuidParamsSchema = z.object({ id: z.uuid() });

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** `?page=1&pageSize=20` (1-based; at most 100 per page). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export function pageWindow(query: PageQuery): { limit: number; offset: number } {
  return { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
}

/** The envelope of every paged list. */
export interface Paged<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export function paged<T>(items: readonly T[], total: number, query: PageQuery): Paged<T> {
  return { items, page: query.page, pageSize: query.pageSize, total };
}

export function invalidRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: 'invalid_request', details: z.prettifyError(error) });
}

export function sendError(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message });
}

/** ISO string of a date, or null. */
export function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}
