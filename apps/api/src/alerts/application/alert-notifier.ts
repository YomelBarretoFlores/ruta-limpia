import type { AlertDecision } from '../domain/alert-policy.js';

/** An alert that was recorded (exactly once per trip and point) and must now be delivered. */
export interface EmittedAlert extends AlertDecision {
  readonly alertId: string;
  readonly routeId: string;
}

/**
 * Port: delivers an emitted alert to the households subscribed to its point. Called after the
 * alert row is committed. Implementations record delivery outcomes themselves (the Web Push adapter
 * updates the recipients/delivered/failed counts); a failure never un-emits the alert.
 */
export interface AlertNotifier {
  notify(alert: EmittedAlert): Promise<void>;
}
