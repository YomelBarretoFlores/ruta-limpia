import { useCallback, useEffect, useState } from 'react';

import type { SubscriptionMessage, SubscriptionPhase } from '../components/AlertSubscriptionCard';
import type { ActivationResult, PushService } from '../push/push-service';
import type { StoredSubscription } from '../push/subscription-store';

/** What the household reads after an activation attempt (Spanish, short sentences). */
export function activationMessage(result: ActivationResult): SubscriptionMessage {
  switch (result.status) {
    case 'subscribed':
      return {
        tone: 'info',
        text: `Listo. Te avisaremos cuando el camión se acerque a tu punto ${result.subscription.pointCode}.`,
      };
    case 'denied':
      return {
        tone: 'danger',
        text:
          'No diste permiso para mostrar avisos. Para activarlos, permite las notificaciones de ' +
          'este sitio en la configuración del navegador y vuelve a intentarlo.',
      };
    case 'unsupported':
      return {
        tone: 'danger',
        text: 'Este dispositivo no puede recibir avisos. Usa el horario de referencia.',
      };
    case 'push_unavailable':
      return {
        tone: 'danger',
        text: 'Los avisos no están disponibles en este momento. Intenta más tarde.',
      };
    case 'rate_limited':
      return {
        tone: 'danger',
        text: 'Hubo muchos intentos. Espera un minuto y vuelve a intentarlo.',
      };
    case 'rejected':
      return { tone: 'danger', text: REJECTIONS[result.reason] ?? REJECTIONS.unknown_point! };
    case 'failed':
      return {
        tone: 'danger',
        text: 'No se pudo activar los avisos. Revisa tu conexión a internet e intenta otra vez.',
      };
  }
}

const REJECTIONS: Record<string, string> = {
  household_route_mismatch:
    'El código de hogar no corresponde a esta zona. Revisa el código de tu sticker o elige un ' +
    'punto de tu zona.',
  unknown_household: 'No encontramos el código de hogar. Revisa el código de tu sticker.',
  unknown_point: 'No encontramos ese punto. Elige otro punto de la lista.',
  ambiguous_point: 'No encontramos ese punto. Elige otro punto de la lista.',
  unsupported_push_service:
    'Este navegador usa un servicio de avisos no compatible. Prueba con Chrome, Firefox o Edge.',
};

export interface AlertSubscriptionState {
  readonly phase: SubscriptionPhase;
  readonly subscription: StoredSubscription | null;
  readonly consent: boolean;
  readonly message: SubscriptionMessage | null;
  readonly setConsent: (consent: boolean) => void;
  readonly activate: () => void;
  readonly cancel: () => void;
}

/** The subscription of this browser to the household's point, with consent. */
export function useAlertSubscription(
  push: PushService,
  target: {
    readonly routeCode: string;
    readonly pointCode: string | null;
    readonly householdCode: string | null;
  } | null,
): AlertSubscriptionState {
  const [phase, setPhase] = useState<SubscriptionPhase>('checking');
  const [subscription, setSubscription] = useState<StoredSubscription | null>(null);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<SubscriptionMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    void push.current().then((current) => {
      if (cancelled) return;
      setSubscription(current);
      setPhase(current === null ? 'idle' : 'subscribed');
    });
    return () => {
      cancelled = true;
    };
  }, [push]);

  const routeCode = target?.routeCode ?? null;
  const pointCode = target?.pointCode ?? null;
  const householdCode = target?.householdCode ?? null;

  const activate = useCallback(() => {
    if (routeCode === null || pointCode === null || !consent) return;
    setPhase('activating');
    setMessage(null);
    void push.activate({ routeCode, pointCode, householdCode }).then((result) => {
      setMessage(activationMessage(result));
      if (result.status === 'subscribed') {
        setSubscription(result.subscription);
        setPhase('subscribed');
      } else {
        setPhase('idle');
      }
    });
  }, [push, routeCode, pointCode, householdCode, consent]);

  const cancel = useCallback(() => {
    setPhase('cancelling');
    setMessage(null);
    void push.cancel().then((result) => {
      if (result.status === 'cancelled') {
        setSubscription(null);
        setConsent(false);
        setPhase('idle');
        setMessage({
          tone: 'info',
          text: 'Cancelaste los avisos. Ya no recibirás notificaciones.',
        });
      } else {
        setPhase('subscribed');
        setMessage({
          tone: 'danger',
          text: 'No se pudo cancelar. Revisa tu conexión a internet e intenta otra vez.',
        });
      }
    });
  }, [push]);

  return { phase, subscription, consent, message, setConsent, activate, cancel };
}
