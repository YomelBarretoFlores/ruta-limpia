import { describe, expect, it } from 'vitest';

import { parseCsv, toCsv } from '../../shared/domain/csv.js';
import type { SurveyRecord } from '../application/household-survey-service.js';
import { readSurveyCsv, SURVEY_CSV_COLUMNS, surveyCsvRow } from './survey-csv.js';

const HEADER =
  'household_code,wave,surveyed_on,q2_lead_time,q11_satisfaction,q12_not_heard,q14_channels,q14_other';

describe('readSurveyCsv', () => {
  it('reads each row into a survey command, tolerant of case, spaces and Sí/No', () => {
    const reading = readSurveyCsv(
      `${HEADER}\r\n h-001 ,POST,2026-12-15,0_15,5,Sí,music|other,Radio\r\nH-002,pre,2026-10-15,,,no,,\r\n`,
    );

    expect(reading.status).toBe('ok');
    if (reading.status !== 'ok') return;
    expect(reading.rows[0]).toMatchObject({
      line: 2,
      errors: [],
      command: {
        householdCode: 'H-001',
        wave: 'post',
        surveyedOn: '2026-12-15',
        leadTime: '0_15',
        satisfaction: 5,
        notHeard: true,
        channels: ['music', 'other'],
        channelOther: 'Radio',
        knowsSchedule: null,
        annoyance: null,
      },
    });
    expect(reading.rows[1]?.command).toMatchObject({ wave: 'pre', notHeard: false, channels: [] });
  });

  it('reports every problem of every row with its line and column', () => {
    const reading = readSurveyCsv(
      `${HEADER}\nH-001,later,2026-02-30,soon,9,maybe,music|tv,\n,pre,2026-10-15,,,,,\nH-003,pre\n`,
    );

    expect(reading.status).toBe('ok');
    if (reading.status !== 'ok') return;
    expect(reading.rows.map((r) => [r.command, r.errors])).toEqual([
      [
        null,
        [
          { line: 2, column: 'wave', problem: 'invalid_value' },
          { line: 2, column: 'surveyed_on', problem: 'invalid_value' },
          { line: 2, column: 'q14_channels', problem: 'invalid_value' },
          { line: 2, column: 'q2_lead_time', problem: 'invalid_value' },
          { line: 2, column: 'q11_satisfaction', problem: 'invalid_value' },
          { line: 2, column: 'q12_not_heard', problem: 'invalid_value' },
        ],
      ],
      [null, [{ line: 3, column: 'household_code', problem: 'required' }]],
      [null, [{ line: 4, column: null, problem: 'expected_8_fields' }]],
    ]);
  });

  it('refuses a header with unknown, repeated or missing columns, and broken CSV', () => {
    expect(readSurveyCsv('household_code,wave,address,wave\n')).toEqual({
      status: 'invalid_csv',
      errors: [
        { line: 1, column: 'address', problem: 'unknown_column' },
        { line: 1, column: 'wave', problem: 'duplicate_column' },
        { line: 1, column: 'surveyed_on', problem: 'missing_column' },
      ],
    });
    expect(readSurveyCsv(`${HEADER}\nH-001,pre,"2026-10-15\n`)).toEqual({
      status: 'invalid_csv',
      errors: [{ line: 2, column: null, problem: 'unterminated_quote' }],
    });
  });

  it('reads back what the export writes', () => {
    const survey: SurveyRecord = {
      id: 'id',
      householdId: 'hh',
      householdCode: 'H-001',
      routeCode: 'RI-01',
      wave: 'post',
      surveyedOn: '2026-12-15',
      knowsSchedule: true,
      leadTime: 'after_pass',
      missedPickups: '1_2',
      litterSeen: 'often',
      separates: 'sometimes',
      alertsHelped: 4,
      easyToUse: 5,
      etaReliable: 3,
      streetCleaner: 2,
      keepSystem: 5,
      satisfaction: 4,
      annoyance: null,
      notHeard: true,
      interrupted: 'not_heard',
      channels: ['alert', 'other'],
      channelOther: 'Junta vecinal, "la de los martes"',
      access: 'no',
      altChannel: 'Perifoneo',
      importBatchId: null,
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const csv = toCsv(SURVEY_CSV_COLUMNS, [surveyCsvRow(survey)]);
    expect(parseCsv(csv)[0]?.fields).toEqual([...SURVEY_CSV_COLUMNS]);

    const reading = readSurveyCsv(csv);

    expect(reading.status === 'ok' && reading.rows[0]?.command).toEqual({
      householdCode: 'H-001',
      wave: 'post',
      surveyedOn: '2026-12-15',
      knowsSchedule: true,
      leadTime: 'after_pass',
      missedPickups: '1_2',
      litterSeen: 'often',
      separates: 'sometimes',
      alertsHelped: 4,
      easyToUse: 5,
      etaReliable: 3,
      streetCleaner: 2,
      keepSystem: 5,
      satisfaction: 4,
      annoyance: null,
      notHeard: true,
      interrupted: 'not_heard',
      channels: ['alert', 'other'],
      channelOther: 'Junta vecinal, "la de los martes"',
      access: 'no',
      altChannel: 'Perifoneo',
    });
  });
});
