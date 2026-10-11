/** The pilot's local time zone (Peru, no daylight saving time). */
const PILOT_TIME_ZONE = 'America/Lima';

const LOCAL_TIME = new Intl.DateTimeFormat('es-PE', {
  timeZone: PILOT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface ProximityAlertMessageInput {
  readonly alertId: string;
  readonly subscriptionId: string;
  readonly pointCode: string;
  readonly pointName: string;
  /** The ETA communicated when the alert was emitted (never recomputed afterwards). */
  readonly predictedPassAt: Date;
  /** When the message is sent. */
  readonly now: Date;
}

/**
 * The Web Push payload of a proximity alert. The service worker shows `title` and `body`, opens
 * `url` on click, and confirms reception with `alertId` and `subscriptionId`.
 */
export interface ProximityAlertMessage {
  readonly type: 'proximity_alert';
  readonly alertId: string;
  readonly subscriptionId: string;
  readonly pointCode: string;
  readonly pointName: string;
  /** ISO 8601. */
  readonly predictedPassAt: string;
  readonly secondsRemaining: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
}

/** Builds the citizen-facing alert (Spanish, Peru) for one subscription. */
export function buildProximityAlertMessage(
  input: ProximityAlertMessageInput,
): ProximityAlertMessage {
  const secondsRemaining = Math.max(
    0,
    Math.round((input.predictedPassAt.getTime() - input.now.getTime()) / 1000),
  );
  const minutes = Math.max(1, Math.round(secondsRemaining / 60));
  const clock = LOCAL_TIME.format(input.predictedPassAt);
  return {
    type: 'proximity_alert',
    alertId: input.alertId,
    subscriptionId: input.subscriptionId,
    pointCode: input.pointCode,
    pointName: input.pointName,
    predictedPassAt: input.predictedPassAt.toISOString(),
    secondsRemaining,
    url: `/?p=${encodeURIComponent(input.pointCode)}`,
    title: 'Ruta Limpia · camión cerca',
    body:
      `El camión recolector pasará por ${input.pointCode} en ~${minutes} min (aprox. ${clock}). ` +
      'Saca tus residuos en bolsas cerradas.',
  };
}
