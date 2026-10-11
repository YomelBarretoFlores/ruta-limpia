import {
  CsvSyntaxError,
  parseCsv,
  restoreNeutralized,
  type CsvValue,
} from '../../shared/domain/csv.js';
import type {
  RowError,
  SurveyCommand,
  SurveyImportRow,
  SurveyRecord,
} from '../application/household-survey-service.js';
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
} from '../domain/household-survey.js';

/**
 * The CSV form of Instrument 3, shared by the import, its template and the `instrumento3.csv`
 * export (so an export imports back). One row per household and wave; answers are the codes of
 * docs/indicators.md (booleans `yes`/`no`, several Q14 channels separated by `|`). `route_code` is
 * informative and ignored on import.
 */
export const SURVEY_CSV_COLUMNS = [
  'household_code',
  'route_code',
  'wave',
  'surveyed_on',
  'q1_knows_schedule',
  'q2_lead_time',
  'q3_missed_pickups',
  'q4_litter_seen',
  'q5_separates',
  'q6_alerts_helped',
  'q7_easy_to_use',
  'q8_eta_reliable',
  'q9_street_cleaner',
  'q10_keep_system',
  'q11_satisfaction',
  'q12_annoyance',
  'q12_not_heard',
  'q13_interrupted',
  'q14_channels',
  'q14_other',
  'q15_access',
  'q15_alt_channel',
] as const;
type Column = (typeof SURVEY_CSV_COLUMNS)[number];

const REQUIRED: readonly Column[] = ['household_code', 'wave', 'surveyed_on'];
const TEXT_MAX = 200;
const HOUSEHOLD_CODE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRUE_WORDS = new Set(['yes', 'si', 'sí', 'true', '1']);
const FALSE_WORDS = new Set(['no', 'false', '0']);

export type SurveyCsvReading =
  | { readonly status: 'ok'; readonly rows: SurveyImportRow[] }
  | { readonly status: 'invalid_csv'; readonly errors: RowError[] };

/** Reads a CSV file of surveys: every row's command, or its problems, with its line. */
export function readSurveyCsv(text: string): SurveyCsvReading {
  let records;
  try {
    records = parseCsv(text);
  } catch (error) {
    if (!(error instanceof CsvSyntaxError)) throw error;
    return {
      status: 'invalid_csv',
      errors: [{ line: error.line, column: null, problem: error.problem }],
    };
  }
  const [header, ...body] = records;
  if (header === undefined) return { status: 'ok', rows: [] };
  const names = header.fields.map((name) => name.trim().toLowerCase());
  const headerErrors: RowError[] = [];
  names.forEach((name, index) => {
    if (!(SURVEY_CSV_COLUMNS as readonly string[]).includes(name)) {
      headerErrors.push({ line: header.line, column: name, problem: 'unknown_column' });
    } else if (names.indexOf(name) !== index) {
      headerErrors.push({ line: header.line, column: name, problem: 'duplicate_column' });
    }
  });
  for (const column of REQUIRED) {
    if (!names.includes(column)) {
      headerErrors.push({ line: header.line, column, problem: 'missing_column' });
    }
  }
  if (headerErrors.length > 0) return { status: 'invalid_csv', errors: headerErrors };
  return {
    status: 'ok',
    rows: body.map((record) => readRow(record.line, names as Column[], record.fields)),
  };
}

function readRow(
  line: number,
  names: readonly Column[],
  fields: readonly string[],
): SurveyImportRow {
  const errors: RowError[] = [];
  if (fields.length !== names.length) {
    return {
      line,
      command: null,
      errors: [{ line, column: null, problem: `expected_${names.length}_fields` }],
    };
  }
  const raw = new Map(names.map((name, index) => [name, (fields[index] ?? '').trim()]));
  const fail = (column: Column, problem: 'required' | 'invalid_value') => {
    errors.push({ line, column, problem });
    return null;
  };
  const text = (column: Column): string | null => {
    // The export neutralized formula-like text with one more apostrophe: drop it, so export →
    // import is lossless (see `restoreNeutralized` for a file edited by hand).
    const value = restoreNeutralized(raw.get(column) ?? '');
    if (value === '') return null;
    return value.length > TEXT_MAX ? fail(column, 'invalid_value') : value;
  };
  const choice = <T extends string>(column: Column, options: readonly T[]): T | null => {
    const value = (raw.get(column) ?? '').toLowerCase();
    if (value === '') return null;
    return (options as readonly string[]).includes(value)
      ? (value as T)
      : fail(column, 'invalid_value');
  };
  const yesNo = (column: Column): boolean | null => {
    const value = (raw.get(column) ?? '').toLowerCase();
    if (value === '') return null;
    if (TRUE_WORDS.has(value)) return true;
    return FALSE_WORDS.has(value) ? false : fail(column, 'invalid_value');
  };
  const scale = (column: Column, range: { min: number; max: number }): number | null => {
    const value = raw.get(column) ?? '';
    if (value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= range.min && n <= range.max
      ? n
      : fail(column, 'invalid_value');
  };

  const householdCode = (raw.get('household_code') ?? '').toUpperCase();
  if (householdCode === '') fail('household_code', 'required');
  else if (!HOUSEHOLD_CODE.test(householdCode)) fail('household_code', 'invalid_value');
  const wave = choice('wave', SURVEY_WAVES);
  if (wave === null && (raw.get('wave') ?? '') === '') fail('wave', 'required');
  const surveyedOn = raw.get('surveyed_on') ?? '';
  if (surveyedOn === '') fail('surveyed_on', 'required');
  else if (!isLocalDate(surveyedOn)) fail('surveyed_on', 'invalid_value');
  const channelText = (raw.get('q14_channels') ?? '').toLowerCase();
  const channels = channelText === '' ? [] : channelText.split('|').map((c) => c.trim());
  const knownChannels = channels.filter((c): c is (typeof CHANNELS)[number] =>
    (CHANNELS as readonly string[]).includes(c),
  );
  if (knownChannels.length !== channels.length || new Set(channels).size !== channels.length) {
    fail('q14_channels', 'invalid_value');
  }

  const command: SurveyCommand = {
    householdCode,
    wave: wave ?? 'pre',
    surveyedOn,
    knowsSchedule: yesNo('q1_knows_schedule'),
    leadTime: choice('q2_lead_time', LEAD_TIMES),
    missedPickups: choice('q3_missed_pickups', MISSED_PICKUPS),
    litterSeen: choice('q4_litter_seen', LITTER_SEEN),
    separates: choice('q5_separates', SEPARATES),
    alertsHelped: scale('q6_alerts_helped', AGREEMENT_SCALE),
    easyToUse: scale('q7_easy_to_use', AGREEMENT_SCALE),
    etaReliable: scale('q8_eta_reliable', AGREEMENT_SCALE),
    streetCleaner: scale('q9_street_cleaner', AGREEMENT_SCALE),
    keepSystem: scale('q10_keep_system', AGREEMENT_SCALE),
    satisfaction: scale('q11_satisfaction', AGREEMENT_SCALE),
    annoyance: scale('q12_annoyance', ANNOYANCE_SCALE),
    notHeard: yesNo('q12_not_heard') ?? false,
    interrupted: choice('q13_interrupted', INTERRUPTIONS),
    channels: knownChannels,
    channelOther: text('q14_other'),
    access: choice('q15_access', ACCESS),
    altChannel: text('q15_alt_channel'),
  };
  return { line, command: errors.length === 0 ? command : null, errors };
}

function isLocalDate(value: string): boolean {
  if (!LOCAL_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const yesNoCell = (value: boolean | null) => (value === null ? null : value ? 'yes' : 'no');

/** One survey as a CSV row, in `SURVEY_CSV_COLUMNS` order. */
export function surveyCsvRow(survey: SurveyRecord): CsvValue[] {
  return [
    survey.householdCode,
    survey.routeCode,
    survey.wave,
    survey.surveyedOn,
    yesNoCell(survey.knowsSchedule),
    survey.leadTime,
    survey.missedPickups,
    survey.litterSeen,
    survey.separates,
    survey.alertsHelped,
    survey.easyToUse,
    survey.etaReliable,
    survey.streetCleaner,
    survey.keepSystem,
    survey.satisfaction,
    survey.annoyance,
    yesNoCell(survey.notHeard),
    survey.interrupted,
    survey.channels.join('|'),
    survey.channelOther,
    survey.access,
    survey.altChannel,
  ];
}
