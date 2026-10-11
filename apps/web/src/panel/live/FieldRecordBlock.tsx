import { Num } from '../../shared/ui/Num';
import type { Dispersion, Observation } from '../api/types';
import { formatCalendarDate, formatDuration } from '../format';
import { PHASE_LABELS } from '../labels';

const DISPERSION: Record<Dispersion, string> = { none: 'No', few: 'Pocos', many: 'Muchos' };

const NO_MEASUREMENTS = 'Sin mediciones cargadas: la evaluación se completará con la línea base.';

/** "Registro de campo": the latest Instrument 2 measurements of the route. */
export function FieldRecordBlock({
  observations,
}: {
  readonly observations: readonly Observation[] | null;
}) {
  return (
    <section className="panel-section" aria-labelledby="field-record-title">
      <h2 id="field-record-title" className="panel-section__title">
        Registro de campo
      </h2>
      {observations === null || observations.length === 0 ? (
        <p className="panel-section__note">{NO_MEASUREMENTS}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="visually-hidden">Últimas mediciones de campo</caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Punto</th>
                <th scope="col">Fase</th>
                <th scope="col" className="is-numeric">
                  Exposición
                </th>
                <th scope="col">Residuos dispersos</th>
                <th scope="col" className="is-numeric">
                  Música
                </th>
              </tr>
            </thead>
            <tbody>
              {observations.map((observation) => (
                <tr key={observation.id}>
                  <td className="num">{formatCalendarDate(observation.observedOn)}</td>
                  <th scope="row" className="num">
                    {observation.pointCode}
                  </th>
                  <td>{PHASE_LABELS[observation.phase]}</td>
                  <td className="is-numeric">
                    {observation.exposureMinutes === null ? (
                      '—'
                    ) : (
                      <Num>{observation.exposureMinutes} min</Num>
                    )}
                  </td>
                  <td>
                    {observation.dispersion === null ? '—' : DISPERSION[observation.dispersion]}
                  </td>
                  <td className="is-numeric">
                    {observation.music === null
                      ? '—'
                      : formatDuration(observation.music.musicSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
