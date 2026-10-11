import { Num } from '../../shared/ui/Num';
import { Status } from '../../shared/ui/Status';
import { formatLocalTime } from '../../shared/time';
import { formatAge } from '../format';
import { signalStatus } from '../labels';
import type { LiveTripView } from './live-rows';

export interface LiveSummaryProps {
  readonly trip: LiveTripView | null;
  readonly now: number;
}

/** Vehículo, Señal GPS and Última posición as label and value: a ruled row, not tiles. */
export function LiveSummary({ trip, now }: LiveSummaryProps) {
  const signal = signalStatus(trip?.signal ?? null);
  const fixAt = trip?.lastPosition?.fixTime ?? trip?.lastFixAt ?? null;
  const time = formatLocalTime(fixAt);
  const age = formatAge(fixAt, now);
  return (
    <dl className="summary-row">
      <div className="summary-row__item">
        <dt>Vehículo</dt>
        <dd>
          {trip === null ? (
            <span className="cell-muted">Sin viaje en curso</span>
          ) : (
            <>
              {trip.vehicle.label}
              <span className="summary-row__note">
                {' '}
                · <Num>{Math.round(trip.progress.percent)} %</Num> del tramo
                {trip.progress.offRoute ? ' · fuera de ruta' : ''}
              </span>
            </>
          )}
        </dd>
      </div>
      <div className="summary-row__item">
        <dt>Señal GPS</dt>
        <dd>
          <Status tone={signal.tone} label={signal.label} />
        </dd>
      </div>
      <div className="summary-row__item">
        <dt>Última posición</dt>
        <dd>
          {time === null ? (
            <span className="cell-muted">—</span>
          ) : (
            <>
              <Num>{time}</Num>
              {age !== null && <span className="summary-row__note"> · {age}</span>}
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}
