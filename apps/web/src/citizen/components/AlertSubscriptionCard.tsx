import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Notice } from '../../shared/ui/Notice';
import type { PushSupport } from '../push/push-support';
import { IosInstallSteps } from './IosInstallSteps';

export interface SubscriptionMessage {
  readonly tone: 'info' | 'warning' | 'success' | 'error';
  readonly text: string;
}

export type SubscriptionPhase = 'checking' | 'idle' | 'activating' | 'subscribed' | 'cancelling';

export interface AlertSubscriptionCardProps {
  /** "Zona urbana": the route, for example "Independencia · RI-01". */
  readonly zone: string;
  readonly points: readonly { readonly code: string; readonly name: string }[];
  readonly selectedPointCode: string | null;
  readonly onSelectPoint: (pointCode: string) => void;
  /** From the QR sticker, when present. */
  readonly householdCode: string | null;
  readonly support: PushSupport;
  /** `checking`: reading this browser's subscription. */
  readonly phase: SubscriptionPhase;
  /** The point of the active subscription. */
  readonly subscribedPointCode: string | null;
  readonly consent: boolean;
  readonly onConsentChange: (consent: boolean) => void;
  readonly message: SubscriptionMessage | null;
  readonly onActivate: () => void;
  readonly onCancel: () => void;
}

/** "Suscripción a las alertas": consent-based sign-up for proximity alerts, and cancellation. */
export function AlertSubscriptionCard(props: AlertSubscriptionCardProps) {
  const { phase, message, support } = props;
  return (
    <Card
      id="avisos"
      title="Suscripción a las alertas"
      subtitle="Solo con consentimiento del hogar"
    >
      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
      {phase === 'checking' ? (
        <p>Revisando tus avisos…</p>
      ) : phase === 'subscribed' || phase === 'cancelling' ? (
        <SubscribedView {...props} />
      ) : (
        <SubscriptionForm {...props} />
      )}
      {support !== 'unsupported' && <p className="field__note">Puedes cancelar la suscripción.</p>}
    </Card>
  );
}

function SubscribedView({ subscribedPointCode, phase, onCancel }: AlertSubscriptionCardProps) {
  const cancelling = phase === 'cancelling';
  return (
    <>
      <p className="subscription__active">
        Avisos activados para el punto <strong>{subscribedPointCode}</strong>.
      </p>
      <Button variant="secondary" onClick={onCancel} disabled={cancelling}>
        {cancelling ? 'Cancelando…' : 'Cancelar avisos'}
      </Button>
    </>
  );
}

function SubscriptionForm(props: AlertSubscriptionCardProps) {
  const { zone, points, selectedPointCode, householdCode, support, phase, consent } = props;
  const working = phase === 'activating';
  return (
    <form
      className="subscription"
      onSubmit={(event) => {
        event.preventDefault();
        props.onActivate();
      }}
    >
      <div className="field">
        <label htmlFor="zona">Zona urbana</label>
        <input id="zona" type="text" value={zone} readOnly />
      </div>
      <div className="field">
        <label htmlFor="punto">Punto cercano</label>
        <select
          id="punto"
          value={selectedPointCode ?? ''}
          onChange={(event) => props.onSelectPoint(event.target.value)}
          disabled={working}
        >
          {selectedPointCode === null && (
            <option value="" disabled>
              Elige tu punto
            </option>
          )}
          {points.map((point) => (
            <option key={point.code} value={point.code}>
              {point.code} · {point.name}
            </option>
          ))}
        </select>
      </div>
      {householdCode !== null && (
        <p className="field__note">
          Código de hogar: <strong>{householdCode}</strong>
        </p>
      )}
      <fieldset className="field">
        <legend>Preferencia de aviso</legend>
        <label className="choice">
          <input type="radio" name="preferencia" value="proximidad" checked readOnly />
          Al aproximarse a mi punto
        </label>
      </fieldset>
      <label className="choice choice--consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => props.onConsentChange(event.target.checked)}
          disabled={working}
        />
        Acepto recibir avisos y el uso de mi punto de referencia.
      </label>
      <ul className="subscription__notes">
        <li>No se publicará la dirección del hogar.</li>
        <li>Activar notificaciones depende del dispositivo y de sus permisos.</li>
      </ul>
      {support === 'ios_install' && <IosInstallSteps />}
      {support === 'unsupported' && (
        <Notice tone="warning">
          Este navegador no puede recibir avisos. Usa Chrome, Firefox o Edge actualizados, o el
          horario de referencia.
        </Notice>
      )}
      {support === 'supported' && (
        <Button type="submit" disabled={!consent || selectedPointCode === null || working}>
          {working ? 'Activando…' : 'Activar avisos'}
        </Button>
      )}
    </form>
  );
}
