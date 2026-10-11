import type { BaselineLog, BaselineLogInput } from '../api/types';

export interface BaselineForm {
  readonly serviceDate: string;
  readonly vehicleLabel: string;
  readonly plannedStart: string;
  readonly actualStart: string;
  readonly notes: string;
  /** Pass time `HH:MM` by point code; an empty time means the pass was not seen. */
  readonly passes: Readonly<Record<string, string>>;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptyBaseline(serviceDate: string): BaselineForm {
  return {
    serviceDate,
    vehicleLabel: '',
    plannedStart: '',
    actualStart: '',
    notes: '',
    passes: {},
  };
}

export function baselineFromLog(log: BaselineLog): BaselineForm {
  return {
    serviceDate: log.serviceDate,
    vehicleLabel: log.vehicleLabel ?? '',
    plannedStart: log.plannedStart ?? '',
    actualStart: log.actualStart ?? '',
    notes: log.notes ?? '',
    passes: Object.fromEntries(log.passes.map((pass) => [pass.pointCode, pass.passedAt])),
  };
}

/** Messages for times that are not `HH:MM` (by point code, or by field). */
export function baselineErrors(form: BaselineForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.serviceDate))
    errors.serviceDate = 'Escribe la fecha del recorrido.';
  for (const key of ['plannedStart', 'actualStart'] as const) {
    if (form[key] !== '' && !TIME.test(form[key]))
      errors[key] = 'Usa el formato HH:MM, por ejemplo 07:05.';
  }
  for (const [code, time] of Object.entries(form.passes)) {
    if (time.trim() !== '' && !TIME.test(time.trim()))
      errors[code] = 'Usa HH:MM, por ejemplo 07:42.';
  }
  return errors;
}

/** The log to send: only the points with a time, in the order of the route. */
export function toBaselineLog(
  form: BaselineForm,
  routeCode: string,
  pointOrder: readonly string[],
): BaselineLogInput {
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    routeCode,
    serviceDate: form.serviceDate,
    vehicleLabel: orNull(form.vehicleLabel),
    plannedStart: orNull(form.plannedStart),
    actualStart: orNull(form.actualStart),
    notes: orNull(form.notes),
    passes: pointOrder
      .filter((code) => (form.passes[code] ?? '').trim() !== '')
      .map((code) => ({ pointCode: code, passedAt: form.passes[code]!.trim() })),
  };
}
