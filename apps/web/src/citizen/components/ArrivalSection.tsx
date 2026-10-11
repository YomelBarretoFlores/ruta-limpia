import type { ReactNode } from 'react';

import { formatLocalTime } from '../../shared/time';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Notice';
import { Num } from '../../shared/ui/Num';
import { Section } from '../../shared/ui/Section';
import type { ScheduleEntry } from '../api/types';
import type { ArrivalView, ConnectionStatus } from '../live/live-state';
import { ConnectionBadge } from './ConnectionBadge';
import { ScheduleList } from './ScheduleList';

export interface ArrivalSectionProps {
  /** District and code of the route, for example Independencia and RI-01. */
  readonly route: { readonly district: string; readonly code: string } | null;
  readonly point: { readonly code: string; readonly name: string } | null;
  readonly arrival: ArrivalView;
  readonly schedule: readonly ScheduleEntry[];
  readonly connection: ConnectionStatus;
  /** The map (kept outside so this section stays easy to test). */
  readonly map?: ReactNode;
  /** Shows the "Configurar aviso" button when given. */
  readonly onConfigureAlerts?: () => void;
}

/**
 * "Llegada del camión": when the truck reaches the household's point (the arrival window
 * dominates), then where it is on the map. A stale signal never shows a window: the number is
 * removed and the printed schedule takes its place.
 */
export function ArrivalSection(props: ArrivalSectionProps) {
  const { route, point, arrival, schedule, connection, map, onConfigureAlerts } = props;
  return (
    <Section
      id="llegada"
      title="Llegada del camión"
      kicker={route === null ? undefined : `${route.district} · tramo ${route.code}`}
      aside={<ConnectionBadge status={connection} />}
    >
      {point === null ? (
        <p className="arrival__point">
          Elige tu punto en «Avisos de llegada» o escanea el código QR de tu punto.
        </p>
      ) : (
        <>
          <p className="arrival__point">
            Tu punto <strong className="num">{point.code}</strong>
            <span className="arrival__point-name"> · {point.name}</span>
          </p>
          <div className="arrival__status" aria-live="polite">
            <ArrivalStatus arrival={arrival} schedule={schedule} />
          </div>
        </>
      )}
      {map}
      {onConfigureAlerts !== undefined && (
        <Button variant="secondary" onClick={onConfigureAlerts}>
          Configurar aviso
        </Button>
      )}
    </Section>
  );
}

/** "8 a 12 min", or "menos de 4 min" when the window starts now. */
function arrivalWindowText(minMinutes: number, maxMinutes: number): string {
  return minMinutes === 0 ? `menos de ${maxMinutes} min` : `${minMinutes} a ${maxMinutes} min`;
}

function ArrivalStatus({
  arrival,
  schedule,
}: {
  readonly arrival: ArrivalView;
  readonly schedule: readonly ScheduleEntry[];
}) {
  switch (arrival.kind) {
    case 'loading':
      return <p className="arrival__message">Buscando el camión…</p>;
    case 'no_trip':
      return (
        <>
          <p className="arrival__message">El camión aún no inicia el recorrido.</p>
          <ScheduleList schedule={schedule} />
        </>
      );
    case 'starting':
      return (
        <p className="arrival__message">
          El camión inició el recorrido. En breve verás la llegada estimada.
        </p>
      );
    case 'live':
      return (
        <div className="arrival">
          <p className="arrival__label">Llegada estimada</p>
          <p className="arrival__window num">
            {arrivalWindowText(arrival.minMinutes, arrival.maxMinutes)}
          </p>
          {arrival.updatedAt !== null && (
            <p className="arrival__updated">
              Actualizado <Num>{formatLocalTime(arrival.updatedAt)}</Num>
            </p>
          )}
        </div>
      );
    case 'stale':
      return (
        <>
          <Notice tone="warn" title="Sin actualización">
            <p>
              La señal del camión se interrumpió
              {arrival.updatedAt === null ? '' : ` a las ${formatLocalTime(arrival.updatedAt)}`}.
              Usa el horario de referencia.
            </p>
          </Notice>
          <ScheduleList schedule={schedule} />
        </>
      );
    case 'passed':
      return (
        <p className="arrival__message">
          {arrival.passedAt === null
            ? 'El camión ya pasó por tu punto.'
            : `El camión ya pasó por tu punto a las ${formatLocalTime(arrival.passedAt)}.`}
        </p>
      );
  }
}
