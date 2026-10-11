import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { z } from 'zod';

import { actorOf, panelRoute } from '../../../auth/infrastructure/http/panel-guard.js';
import { toCsv } from '../../../shared/domain/csv.js';
import { sendCsv } from '../../../shared/infrastructure/http/csv-reply.js';
import {
  codeSchema,
  invalidRequest,
  localDateSchema,
  pageQuerySchema,
  pageWindow,
  paged,
  sendError,
  uuidParamsSchema,
} from '../../../shared/infrastructure/http/panel-http.js';
import {
  MAX_IMPORT_ROWS,
  type HouseholdSurveyService,
  type SurveyCommand,
  type SurveyResult,
} from '../../application/household-survey-service.js';
import {
  ACCESS,
  ANNOYANCE_SCALE,
  AGREEMENT_SCALE,
  CHANNELS,
  INTERRUPTIONS,
  LEAD_TIMES,
  LITTER_SEEN,
  MISSED_PICKUPS,
  SEPARATES,
  SURVEY_WAVES,
} from '../../domain/household-survey.js';
import { readSurveyCsv, SURVEY_CSV_COLUMNS } from '../survey-csv.js';
import { blankToNull } from './field-http.js';

/** The largest CSV file accepted (about 1000 rows of long answers). */
export const MAX_IMPORT_BYTES = 1024 * 1024;

const agreement = z
  .number()
  .int()
  .min(AGREEMENT_SCALE.min)
  .max(AGREEMENT_SCALE.max)
  .nullable()
  .default(null);
const optionalText = z.string().trim().max(200).nullable().default(null);

const surveyBodySchema = z.object({
  householdCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/)
    .transform((code) => code.toUpperCase()),
  wave: z.enum(SURVEY_WAVES),
  surveyedOn: localDateSchema,
  knowsSchedule: z.boolean().nullable().default(null),
  leadTime: z.enum(LEAD_TIMES).nullable().default(null),
  missedPickups: z.enum(MISSED_PICKUPS).nullable().default(null),
  litterSeen: z.enum(LITTER_SEEN).nullable().default(null),
  separates: z.enum(SEPARATES).nullable().default(null),
  alertsHelped: agreement,
  easyToUse: agreement,
  etaReliable: agreement,
  streetCleaner: agreement,
  keepSystem: agreement,
  satisfaction: agreement,
  annoyance: z
    .number()
    .int()
    .min(ANNOYANCE_SCALE.min)
    .max(ANNOYANCE_SCALE.max)
    .nullable()
    .default(null),
  notHeard: z.boolean().default(false),
  interrupted: z.enum(INTERRUPTIONS).nullable().default(null),
  channels: z
    .array(z.enum(CHANNELS))
    .max(CHANNELS.length)
    .refine((channels) => new Set(channels).size === channels.length, 'Channels must not repeat')
    .default([]),
  channelOther: optionalText,
  access: z.enum(ACCESS).nullable().default(null),
  altChannel: optionalText,
});

const listQuerySchema = pageQuerySchema.extend({
  route: codeSchema.optional(),
  wave: z.enum(SURVEY_WAVES).optional(),
  household: codeSchema.optional(),
});

const FAILURES: Record<Exclude<SurveyResult['status'], 'ok'>, [number, string]> = {
  unknown_household: [422, 'There is no household with this code.'],
  duplicate_survey: [409, 'The household already has a survey of this wave.'],
  invalid_survey: [422, 'The survey is inconsistent; see problems.'],
  not_found: [404, 'There is no such survey.'],
};

function send(reply: FastifyReply, result: SurveyResult, okStatus: number) {
  if (result.status === 'ok') {
    return okStatus === 204
      ? reply.code(204).send()
      : reply.code(okStatus).send({ survey: result.survey });
  }
  const [status, message] = FAILURES[result.status];
  return result.status === 'invalid_survey'
    ? reply.code(status).send({ error: result.status, message, problems: result.problems })
    : sendError(reply, status, result.status, message);
}

function toCommand(body: z.infer<typeof surveyBodySchema>): SurveyCommand {
  return {
    ...body,
    channelOther: blankToNull(body.channelOther),
    altChannel: blankToNull(body.altChannel),
  };
}

export interface PanelHouseholdSurveyRoutesOptions {
  readonly surveys: Pick<
    HouseholdSurveyService,
    'list' | 'get' | 'create' | 'update' | 'delete' | 'import'
  >;
}

/**
 * Instrument 3, the household survey (registered under `/api/panel`):
 *
 * - `GET /household-surveys?route=&wave=&household=&page=&pageSize=` → paged surveys;
 * - `GET /household-surveys/:id` → `{ survey }`;
 * - `POST /household-surveys` → 201 `{ survey }` (409 when the household has that wave);
 * - `PUT /household-surveys/:id` (the whole edited survey) → `{ survey }`;
 * - `DELETE /household-surveys/:id` → 204;
 * - `POST /household-surveys/import` (`Content-Type: text/csv`, keyed by `household_code` and
 *   `wave`) → `{ batchId, created, updated }`, or `422 invalid_rows` with every row's problems
 *   and nothing imported;
 * - `GET /household-surveys/template.csv` → the CSV header to fill in.
 */
export const panelHouseholdSurveyRoutes: FastifyPluginCallback<
  PanelHouseholdSurveyRoutesOptions
> = (app, { surveys }, done) => {
  // Encapsulated: only this plugin's routes read CSV bodies.
  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'string', bodyLimit: MAX_IMPORT_BYTES },
    (_request, body, parsed) => parsed(null, body),
  );

  app.get('/household-surveys', panelRoute('surveys:read'), async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const { route, wave, household } = query.data;
    const { items, total } = await surveys.list(
      {
        ...(route === undefined ? {} : { routeCode: route }),
        ...(wave === undefined ? {} : { wave }),
        ...(household === undefined ? {} : { householdCode: household }),
      },
      pageWindow(query.data),
    );
    return reply.send(paged(items, total, query.data));
  });

  app.get('/household-surveys/template.csv', panelRoute('surveys:write'), (_request, reply) =>
    sendCsv(reply, 'plantilla-instrumento3.csv', toCsv(SURVEY_CSV_COLUMNS, [])),
  );

  app.get('/household-surveys/:id', panelRoute('surveys:read'), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    const survey = params.success ? await surveys.get(params.data.id) : null;
    return survey === null ? send(reply, { status: 'not_found' }, 200) : reply.send({ survey });
  });

  app.post('/household-surveys', panelRoute('surveys:write'), async (request, reply) => {
    const body = surveyBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    return send(reply, await surveys.create(toCommand(body.data), actorOf(request)), 201);
  });

  app.put('/household-surveys/:id', panelRoute('surveys:write'), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return send(reply, { status: 'not_found' }, 200);
    const body = surveyBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply, body.error);
    const result = await surveys.update(params.data.id, toCommand(body.data), actorOf(request));
    return send(reply, result, 200);
  });

  app.delete('/household-surveys/:id', panelRoute('surveys:write'), async (request, reply) => {
    const params = uuidParamsSchema.safeParse(request.params);
    if (!params.success) return send(reply, { status: 'not_found' }, 204);
    return send(reply, await surveys.delete(params.data.id, actorOf(request)), 204);
  });

  app.post('/household-surveys/import', panelRoute('surveys:write'), async (request, reply) => {
    if (typeof request.body !== 'string') {
      return sendError(reply, 415, 'unsupported_media_type', 'Send the file as text/csv.');
    }
    const reading = readSurveyCsv(request.body);
    if (reading.status === 'invalid_csv') {
      return reply.code(400).send({
        error: 'invalid_csv',
        message: 'The file is not a survey CSV; see errors.',
        errors: reading.errors,
      });
    }
    const result = await surveys.import(reading.rows, actorOf(request));
    switch (result.status) {
      case 'imported':
        return reply.send({
          batchId: result.batchId,
          created: result.created,
          updated: result.updated,
        });
      case 'invalid_rows':
        return reply.code(422).send({
          error: 'invalid_rows',
          message: 'Some rows have problems; nothing was imported.',
          errors: result.errors,
        });
      case 'empty':
        return sendError(reply, 422, 'empty_file', 'The file has no survey rows.');
      case 'too_many_rows':
        return sendError(
          reply,
          422,
          'too_many_rows',
          `A file may hold at most ${MAX_IMPORT_ROWS} rows.`,
        );
    }
  });

  done();
};
