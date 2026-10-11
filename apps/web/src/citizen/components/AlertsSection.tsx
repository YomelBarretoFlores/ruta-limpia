import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice, type NoticeTone } from '../../shared/ui/Notice';
import { Section } from '../../shared/ui/Section';
import type { PushSupport } from '../push/push-support';
import { IosInstallSteps } from './IosInstallSteps';

export interface SubscriptionMessage {
  readonly tone: NoticeTone;
  readonly text: string;
}

export type SubscriptionPhase = 'checking' | 'idle' | 'activating' | 'subscribed' | 'cancelling';

export interface AlertsSectionProps {
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

/** "Avisos de llegada": consent-based sign-up for proximity alerts, and cancellation. */
export function AlertsSection(props: AlertsSectionProps) {
  const { phase, message, support } = props;
  return (
    <Section id="avisos" title="Avisos de llegada" kicker="Solo con consentimiento del hogar">
      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
      {phase === 'checking' ? (
        <p>Revisando tus avisos…</p>
      ) : phase === 'subscribed' || phase === 'cancelling' ? (
        <SubscribedView {...props} />
      ) : (
        <SubscriptionForm {...props} />
      )}
      {support !== 'unsupported' && (
        <p className="alerts__note">Puedes cancelar los avisos cuando quieras.</p>
      )}
    </Section>
  );
}

function SubscribedView({ subscribedPointCode, phase, onCancel }: AlertsSectionProps) {
  const cancelling = phase === 'cancelling';
  return (
    <>
      <p className="alerts__active">
        Avisos activados para el punto <strong className="num">{subscribedPointCode}</strong>.
      </p>
      <Button variant="destructive" onClick={onCancel} disabled={cancelling}>
        {cancelling ? 'Cancelando…' : 'Cancelar avisos'}
      </Button>
    </>
  );
}

function SubscriptionForm(props: AlertsSectionProps) {
  const { zone, points, selectedPointCode, householdCode, support, phase, consent } = props;
  const working = phase === 'activating';
  return (
    <form
      className="alerts__form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onActivate();
      }}
    >
      <Field
        id="zona"
        label="Zona urbana"
        control={(control) => (
          <input {...control} className="input" type="text" value={zone} readOnly />
        )}
      />
      <Field
        id="punto"
        label="Punto cercano"
        hint="El punto de referencia donde dejas tus residuos."
        control={(control) => (
          <select
            {...control}
            className="select"
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
        )}
      />
      {householdCode !== null && (
        <p className="alerts__household">
          Código de hogar: <strong className="num">{householdCode}</strong>
        </p>
      )}
      <fieldset className="choices">
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
      <ul className="alerts__terms">
        <li>No se publicará la dirección del hogar.</li>
        <li>Activar notificaciones depende del dispositivo y de sus permisos.</li>
      </ul>
      {support === 'ios_install' && <IosInstallSteps />}
      {support === 'unsupported' && (
        <Notice tone="warn">
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
