import type { ReactNode } from 'react';

import { formatLocalTime } from '../../shared/time';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Notice } from '../../shared/ui/Notice';
import type { ScheduleEntry } from '../api/types';
import type { ArrivalView, ConnectionStatus } from '../live/live-state';
import { ConnectionBadge } from './ConnectionBadge';
import { ScheduleList } from './ScheduleList';

export interface ArrivalCardProps {
  /** District and code of the route, for example Independencia and RI-01. */
  readonly route: { readonly district: string; readonly code: string } | null;
  readonly point: { readonly code: string; readonly name: string } | null;
  readonly arrival: ArrivalView;
  readonly schedule: readonly ScheduleEntry[];
  readonly connection: ConnectionStatus;
  /** The map (kept outside so this card stays easy to test). */
  readonly map?: ReactNode;
  /** Shows the "Configurar aviso" button when given. */
  readonly onConfigureAlerts?: () => void;
}

/** "Mapa y llegada del camión": where the truck is and when it reaches the household's point. */
export function ArrivalCard(props: ArrivalCardProps) {
  const { route, point, arrival, schedule, connection, map, onConfigureAlerts } = props;
  return (
    <Card
      id="llegada"
      title="Mapa y llegada del camión"
      subtitle={route === null ? undefined : `${route.district} · tramo ${route.code}`}
      aside={<ConnectionBadge status={connection} />}
    >
      {map}
      {point === null ? (
        <p className="arrival__point">Escanea el código QR de tu punto de referencia.</p>
      ) : (
        <p className="arrival__point">
          Tu punto de referencia <strong>{point.code}</strong>
          <span className="arrival__point-name"> · {point.name}</span>
        </p>
      )}
      {point !== null && (
        <div className="arrival__status" aria-live="polite">
          <ArrivalStatus arrival={arrival} schedule={schedule} />
        </div>
      )}
      <p className="arrival__hint">
        Saca los residuos cuando el aviso indique proximidad y usa bolsas cerradas.
      </p>
      {onConfigureAlerts !== undefined && (
        <Button onClick={onConfigureAlerts}>Configurar aviso</Button>
      )}
    </Card>
  );
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
      return <p>Buscando el camión…</p>;
    case 'no_trip':
      return (
        <>
          <p className="arrival__headline">El camión aún no inicia el recorrido</p>
          <ScheduleList schedule={schedule} />
        </>
      );
    case 'starting':
      return (
        <p className="arrival__headline">
          El camión inició el recorrido. Pronto verás la llegada estimada.
        </p>
      );
    case 'live':
      return (
        <>
          <p className="arrival__eta">
            Llegada estimada:{' '}
            <strong>
              {arrival.minMinutes === 0
                ? `menos de ${arrival.maxMinutes} minutos`
                : `${arrival.minMinutes} a ${arrival.maxMinutes} minutos`}
            </strong>
          </p>
          {arrival.updatedAt !== null && (
            <p className="arrival__updated">Actualización: {formatLocalTime(arrival.updatedAt)}</p>
          )}
        </>
      );
    case 'stale':
      return (
        <>
          <Notice tone="warning">
            Sin actualización: la señal del camión se interrumpió. Usa el horario de referencia.
          </Notice>
          {arrival.updatedAt !== null && (
            <p className="arrival__updated">Última señal: {formatLocalTime(arrival.updatedAt)}</p>
          )}
          <ScheduleList schedule={schedule} />
        </>
      );
    case 'passed':
      return (
        <p className="arrival__headline">
          {arrival.passedAt === null
            ? 'El camión ya pasó por tu punto.'
            : `El camión ya pasó por tu punto a las ${formatLocalTime(arrival.passedAt)}`}
        </p>
      );
  }
}
