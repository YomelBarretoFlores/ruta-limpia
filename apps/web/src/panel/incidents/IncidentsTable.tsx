import { Status } from '../../shared/ui/Status';
import type { Incident } from '../api/types';
import { formatDateTime } from '../format';
import { INCIDENT_KIND_LABELS } from '../labels';

export interface IncidentsTableProps {
  readonly incidents: readonly Incident[];
  readonly canUpdate: boolean;
  readonly onEdit: (incident: Incident) => void;
  readonly onResolve: (incident: Incident) => void;
  readonly onReopen: (incident: Incident) => void;
  /** The incident being reopened, whose button waits for the answer. */
  readonly reopeningId?: string | null;
}

export function IncidentsTable({
  incidents,
  canUpdate,
  onEdit,
  onResolve,
  onReopen,
  reopeningId = null,
}: IncidentsTableProps) {
  if (incidents.length === 0) {
    return <p className="table-empty">No hay incidencias con estos filtros.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Incidencias</caption>
        <thead>
          <tr>
            <th scope="col">Fecha y hora</th>
            <th scope="col">Tipo</th>
            <th scope="col">Punto</th>
            <th scope="col">Descripción</th>
            <th scope="col">Registró</th>
            <th scope="col">Estado</th>
            {canUpdate && (
              <th scope="col">
                <span className="visually-hidden">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => {
            const kind = INCIDENT_KIND_LABELS[incident.kind];
            return (
              <tr key={incident.id}>
                <td className="num">{formatDateTime(incident.occurredAt)}</td>
                <th scope="row">{kind}</th>
                <td className="num">{incident.pointCode ?? 'Toda la ruta'}</td>
                <td>
                  {incident.description ?? <span className="cell-muted">—</span>}
                  {incident.resolutionNote !== null && (
                    <span className="cell-block cell-muted">
                      Resolución: {incident.resolutionNote}
                    </span>
                  )}
                </td>
                <td>{incident.reportedBy ?? '—'}</td>
                <td>
                  {incident.resolvedAt === null ? (
                    <Status tone="stale" label="Abierta" />
                  ) : (
                    <Status tone="none" label={`Resuelta ${formatDateTime(incident.resolvedAt)}`} />
                  )}
                </td>
                {canUpdate && (
                  <td className="cell-actions">
                    <button type="button" className="link-button" onClick={() => onEdit(incident)}>
                      Corregir <span className="visually-hidden">{kind}</span>
                    </button>
                    {incident.resolvedAt === null ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onResolve(incident)}
                      >
                        Resolver <span className="visually-hidden">{kind}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        disabled={reopeningId !== null}
                        onClick={() => onReopen(incident)}
                      >
                        Reabrir <span className="visually-hidden">{kind}</span>
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
