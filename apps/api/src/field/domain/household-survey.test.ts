import { describe, expect, it } from 'vitest';

import { surveyProblems, type SurveyAnswers } from './household-survey.js';

const BLANK: SurveyAnswers = {
  knowsSchedule: null,
  leadTime: null,
  missedPickups: null,
  litterSeen: null,
  separates: null,
  alertsHelped: null,
  easyToUse: null,
  etaReliable: null,
  streetCleaner: null,
  keepSystem: null,
  satisfaction: null,
  annoyance: null,
  notHeard: false,
  interrupted: null,
  channels: [],
  channelOther: null,
  access: null,
  altChannel: null,
};

describe('surveyProblems', () => {
  it('accepts a blank survey in either wave', () => {
    expect(surveyProblems('pre', BLANK)).toEqual([]);
    expect(surveyProblems('post', BLANK)).toEqual([]);
  });

  it('keeps questions 6 to 11 to the post wave', () => {
    expect(surveyProblems('pre', { ...BLANK, satisfaction: 4 })).toEqual([
      'post_only_answer_in_pre',
    ]);
    expect(surveyProblems('post', { ...BLANK, satisfaction: 4, alertsHelped: 5 })).toEqual([]);
  });

  it('does not take "No la escuché" together with an annoyance score', () => {
    expect(surveyProblems('pre', { ...BLANK, annoyance: 0, notHeard: true })).toEqual([
      'annoyance_and_not_heard',
    ]);
    expect(surveyProblems('pre', { ...BLANK, notHeard: true })).toEqual([]);
  });

  it('pairs the "Otro" channel with its text, and the alternative channel with no access', () => {
    expect(surveyProblems('post', { ...BLANK, channels: ['music', 'other'] })).toEqual([
      'other_channel_text_required',
    ]);
    expect(surveyProblems('post', { ...BLANK, channelOther: 'Radio' })).toEqual([
      'other_channel_text_without_other',
    ]);
    expect(surveyProblems('post', { ...BLANK, access: 'yes', altChannel: 'Perifoneo' })).toEqual([
      'alt_channel_without_no_access',
    ]);
    expect(surveyProblems('post', { ...BLANK, access: 'no', altChannel: 'Perifoneo' })).toEqual([]);
  });
});
