import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { z } from 'zod';

import { panelRoute } from '../../../auth/infrastructure/http/panel-guard.js';
import type { HouseholdSurveyService } from '../../../field/application/household-survey-service.js';
import { SURVEY_CSV_COLUMNS, surveyCsvRow } from '../../../field/infrastructure/survey-csv.js';
import { toCsv } from '../../../shared/domain/csv.js';
import { sendCsv } from '../../../shared/infrastructure/http/csv-reply.js';
import {
  codeSchema,
  invalidRequest,
  localDateSchema,
  sendError,
} from '../../../shared/infrastructure/http/panel-http.js';
import type { CsvTable, InstrumentExports } from '../../application/export-ports.js';
import type { IndicatorService } from '../../application/indicator-service.js';
import { indicatorTable, usageTable } from './indicator-tables.js';
import { indicatorQuerySchema } from './panel-indicator-routes.js';

/** The most surveys one export holds (the pilot has at most 100 households, two waves each). */
const MAX_EXPORTED_SURVEYS = 10_000;

const filterSchema = z
  .object({
    route: codeSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });

export interface PanelExportRoutesOptions {
  readonly instruments: InstrumentExports;
  readonly indicators: Pick<IndicatorService, 'report'>;
  readonly surveys: Pick<HouseholdSurveyService, 'list'>;
}

function send(reply: FastifyReply, fileName: string, table: CsvTable) {
  return sendCsv(reply, fileName, toCsv(table.header, table.rows));
}

/**
 * CSV downloads for the analysts (registered under `/api/panel`, permission `exports:read`;
 * plain `GET`s with the session cookie, answered as attachments). UTF-8 with a BOM, comma
 * separated, RFC 4180 quoting; see docs/indicators.md for every column.
 *
 * - `GET /exports/instrumento1.csv?route=&from=&to=` (all optional);
 * - `GET /exports/instrumento2.csv?route=&from=&to=` (all optional);
 * - `GET /exports/instrumento3.csv?route=` (optional);
 * - `GET /exports/indicadores.csv?route=&from=&to=` (required, as `/indicators`);
 * - `GET /exports/uso.csv?route=&from=&to=` (required): weekly use per household.
 */
export const panelExportRoutes: FastifyPluginCallback<PanelExportRoutesOptions> = (
  app,
  { instruments, indicators, surveys },
  done,
) => {
  const access = panelRoute('exports:read');

  app.get('/exports/instrumento1.csv', access, async (request, reply) => {
    const query = filterSchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, from, to } = query.data;
    const table = await instruments.instrument1({ routeCode: route, from, to });
    return send(reply, 'instrumento1.csv', table);
  });

  app.get('/exports/instrumento2.csv', access, async (request, reply) => {
    const query = filterSchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, from, to } = query.data;
    const table = await instruments.instrument2({ routeCode: route, from, to });
    return send(reply, 'instrumento2.csv', table);
  });

  app.get('/exports/instrumento3.csv', access, async (request, reply) => {
    const query = filterSchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route } = query.data;
    const { items } = await surveys.list(route === undefined ? {} : { routeCode: route }, {
      limit: MAX_EXPORTED_SURVEYS,
      offset: 0,
    });
    return send(reply, 'instrumento3.csv', {
      header: SURVEY_CSV_COLUMNS,
      rows: items.map(surveyCsvRow),
    });
  });

  for (const [fileName, table] of [
    ['indicadores.csv', indicatorTable],
    ['uso.csv', usageTable],
  ] as const) {
    app.get(`/exports/${fileName}`, access, async (request, reply) => {
      const query = indicatorQuerySchema.safeParse(request.query);
      if (!query.success) return invalidRequest(reply, query.error);
      const { route, from, to } = query.data;
      const result = await indicators.report({ routeCode: route, from, to });
      if (result.status === 'unknown_route') {
        return sendError(reply, 422, 'unknown_route', 'There is no route with this code.');
      }
      return send(reply, fileName, table(result.report));
    });
  }

  done();
};
