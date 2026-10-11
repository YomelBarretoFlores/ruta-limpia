import { Num } from '../../shared/ui/Num';
import { Status } from '../../shared/ui/Status';
import { formatLocalTime } from '../../shared/time';
import { ALERT_STATUS, INCIDENT_KIND_LABELS } from '../labels';
import type { LiveRow } from './live-rows';

/** Punto | Paso registrado | Estado del aviso | Entregas | Incidencia, one row per point. */
export function PassTable({
  rows,
  caption,
}: {
  readonly rows: readonly LiveRow[];
  readonly caption: string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Punto</th>
            <th scope="col">Paso registrado</th>
            <th scope="col">Estado del aviso</th>
            <th scope="col" className="is-numeric">
              Entregas <span className="cell-note">(recibidos / enviados)</span>
            </th>
            <th scope="col">Incidencia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.pointCode}>
              <th scope="row">
                <span className="num">{row.pointCode}</span>
                <span className="cell-note"> · {row.name}</span>
              </th>
              <td>
                <PassCell row={row} />
              </td>
              <td>
                {row.alertStatus === null ? (
                  <span className="cell-muted">—</span>
                ) : (
                  <Status
                    tone={ALERT_STATUS[row.alertStatus].tone}
                    label={ALERT_STATUS[row.alertStatus].label}
                  />
                )}
              </td>
              <td className="is-numeric">
                {row.deliveries === null ? (
                  <span className="cell-muted">—</span>
                ) : (
                  <>
                    <Num>
                      {row.deliveries.received} / {row.deliveries.sent}
                    </Num>
                    {row.deliveries.failed > 0 && (
                      <span className="cell-note"> · {row.deliveries.failed} fallidas</span>
                    )}
                  </>
                )}
              </td>
              <td>
                {row.incidents.length === 0 ? (
                  <span className="cell-muted">—</span>
                ) : (
                  row.incidents.map((incident) => INCIDENT_KIND_LABELS[incident.kind]).join(', ')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PassCell({ row }: { readonly row: LiveRow }) {
  const passed = formatLocalTime(row.passedAt);
  if (passed !== null) return <Num>{passed}</Num>;
  const predicted = formatLocalTime(row.predictedAt);
  if (predicted !== null) {
    return (
      <span className="cell-muted">
        Estimado <Num>{predicted}</Num>
      </span>
    );
  }
  return <span className="cell-muted">—</span>;
}
