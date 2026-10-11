import { describe, expect, it } from 'vitest';

import type { Survey } from '../api/types';
import {
  emptySurvey,
  missingFields,
  surveyFromRecord,
  surveyProblemsByField,
  toSurveyInput,
} from './survey-form';

describe('survey form', () => {
  it('sends questions 6–11 only with the post wave, and "No la escuché" apart from the scale', () => {
    const form = {
      ...emptySurvey('2026-12-15'),
      householdCode: ' h-001 ',
      wave: 'pre' as const,
      satisfaction: '5',
      annoyance: 'not_heard',
      channels: ['music' as const],
      channelOther: 'Radio',
      access: 'yes' as const,
      altChannel: 'Perifoneo',
    };

    expect(toSurveyInput(form)).toMatchObject({
      householdCode: 'H-001',
      wave: 'pre',
      satisfaction: null,
      annoyance: null,
      notHeard: true,
      channelOther: null,
      altChannel: null,
    });
    expect(toSurveyInput({ ...form, wave: 'post', annoyance: '2' })).toMatchObject({
      satisfaction: 5,
      annoyance: 2,
      notHeard: false,
    });
  });

  it('reads a stored survey back into the form', () => {
    const survey = {
      ...toSurveyInput({ ...emptySurvey('2026-12-15'), householdCode: 'H-002', wave: 'post' }),
      knowsSchedule: false,
      notHeard: true,
      satisfaction: 4,
    } as Survey;

    expect(surveyFromRecord(survey)).toMatchObject({
      householdCode: 'H-002',
      knowsSchedule: 'no',
      annoyance: 'not_heard',
      satisfaction: '4',
      leadTime: '',
    });
  });

  it('asks for the household code, the wave and the date', () => {
    expect(Object.keys(missingFields({ ...emptySurvey(''), householdCode: 'casa 3' }))).toEqual([
      'householdCode',
      'wave',
      'surveyedOn',
    ]);
  });

  it('places the API problems next to their questions', () => {
    expect(surveyProblemsByField(['post_only_answer_in_pre', 'something_else'])).toEqual({
      wave: 'Las preguntas 6 a 11 son solo de la aplicación post.',
    });
  });
});
