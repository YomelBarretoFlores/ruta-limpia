import type {
  Access,
  Channel,
  Interruptions,
  LeadTime,
  LitterSeen,
  MissedPickups,
  PostOnlyQuestion,
  Separates,
  SurveyWave,
} from '../api/types';

/** Instrument 3 (Tabla 19): the questions and their answers as the paper form words them. */

export const WAVE_LABELS: Record<SurveyWave, string> = { pre: 'Pre', post: 'Post' };

export const LEAD_TIME_LABELS: Record<LeadTime, string> = {
  '0_15': '0–15 min',
  '15_60': 'Más de 15 a 60 min',
  '1_3h': 'Más de 1 a 3 h',
  gt_3h: 'Más de 3 h',
  after_pass: 'Después del paso',
};

export const MISSED_LABELS: Record<MissedPickups, string> = {
  '0': '0',
  '1_2': '1–2',
  '3_plus': '3 o más',
};

export const LITTER_LABELS: Record<LitterSeen, string> = {
  never: 'Nunca',
  sometimes: 'A veces',
  often: 'Frecuentemente',
};

export const SEPARATES_LABELS: Record<Separates, string> = {
  yes: 'Sí',
  sometimes: 'A veces',
  no: 'No',
};

export const INTERRUPTION_LABELS: Record<Interruptions, string> = {
  never: 'Nunca',
  '1_2': '1–2 veces',
  '3_plus': '3 o más',
  not_heard: 'No la escuché',
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  music: 'Música',
  alert: 'Alerta',
  web_map: 'Mapa web',
  printed_schedule: 'Horario impreso',
  neighbor: 'Vecino',
  other: 'Otro',
};

export const ACCESS_LABELS: Record<Access, string> = {
  yes: 'Sí',
  with_help: 'Con ayuda',
  no: 'No',
};

/** Questions 6–11, post wave only. */
export const POST_ONLY_LABELS: Record<PostOnlyQuestion, string> = {
  alertsHelped: '6. Las alertas me ayudaron a sacar mis residuos en el momento adecuado.',
  easyToUse: '7. La aplicación es fácil de usar.',
  etaReliable: '8. La hora de llegada anunciada fue confiable.',
  streetCleaner: '9. Mi cuadra está más limpia que antes del piloto.',
  keepSystem: '10. Me gustaría que la municipalidad mantenga el sistema.',
  satisfaction: '11. ¿Qué tan satisfecho está con el sistema de alertas?',
};

/** 1–5 agreement (Q6–Q10). */
export const AGREEMENT_OPTIONS = [
  { value: '1', label: '1 Muy en desacuerdo' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5 Muy de acuerdo' },
] as const;

/** 1–5 satisfaction (Q11). */
export const SATISFACTION_OPTIONS = [
  { value: '1', label: '1 Muy insatisfecho' },
  { value: '2', label: '2 Insatisfecho' },
  { value: '3', label: '3 Neutral' },
  { value: '4', label: '4 Satisfecho' },
  { value: '5', label: '5 Muy satisfecho' },
] as const;

/** Q12: 0–4, or "No la escuché" (recorded apart, never as 0). */
export const ANNOYANCE_OPTIONS = [
  { value: '0', label: '0 Nada' },
  { value: '1', label: '1 Poco' },
  { value: '2', label: '2 Moderadamente' },
  { value: '3', label: '3 Mucho' },
  { value: '4', label: '4 Extremadamente' },
  { value: 'not_heard', label: 'No la escuché' },
] as const;

/** What each import problem means, in words. */
export function importProblemLabel(problem: string): string {
  const duplicate = /^duplicate_of_line_(\d+)$/.exec(problem);
  if (duplicate !== null) return `Repite el hogar y la aplicación de la línea ${duplicate[1]}.`;
  const fields = /^expected_(\d+)_fields$/.exec(problem);
  if (fields !== null) return `La fila debe tener ${fields[1]} columnas, como el encabezado.`;
  return IMPORT_PROBLEMS[problem] ?? problem;
}

const IMPORT_PROBLEMS: Readonly<Record<string, string>> = {
  required: 'Falta este dato.',
  invalid_value: 'El valor no es uno de los códigos permitidos.',
  unknown_household: 'No hay un hogar inscrito con este código.',
  unknown_column: 'La columna no es de la plantilla.',
  duplicate_column: 'La columna está repetida.',
  missing_column: 'Falta esta columna obligatoria.',
  unterminated_quote: 'Unas comillas se abren y no se cierran.',
  text_after_quote: 'Hay texto después de unas comillas de cierre.',
  post_only_answer_in_pre: 'Las preguntas 6 a 11 son solo de la aplicación post.',
  annoyance_and_not_heard: 'La pregunta 12 tiene puntaje y «No la escuché» a la vez.',
  other_channel_text_required: 'Marcó «Otro» medio en la pregunta 14 sin decir cuál.',
  other_channel_text_without_other: 'Hay un texto de «Otro» medio sin marcar «Otro».',
  alt_channel_without_no_access: 'El medio alternativo de la pregunta 15 va solo con «No».',
};
