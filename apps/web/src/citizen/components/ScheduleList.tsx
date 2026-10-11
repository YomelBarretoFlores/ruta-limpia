import type { ScheduleEntry } from '../api/types';
import { formatSchedule } from '../schedule';

/** The printed reference schedule (the fallback when there is no live data). */
export function ScheduleList({ schedule }: { readonly schedule: readonly ScheduleEntry[] }) {
  const lines = formatSchedule(schedule);
  return (
    <div className="schedule">
      <h3 className="schedule__title">Horario de referencia</h3>
      {lines.length === 0 ? (
        <p>Consulta el horario en la municipalidad.</p>
      ) : (
        <ul className="schedule__list">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
