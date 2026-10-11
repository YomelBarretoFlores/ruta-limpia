import { Num } from '../../shared/ui/Num';
import { Status } from '../../shared/ui/Status';
import type { HouseholdListItem } from '../api/types';
import { formatDateTime } from '../format';

export interface HouseholdsTableProps {
  readonly households: readonly HouseholdListItem[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (code: string) => void;
  readonly onToggleAll: (codes: readonly string[], select: boolean) => void;
  readonly canEdit: boolean;
  readonly onEdit: (household: HouseholdListItem) => void;
}

/** Código, punto, suscripciones activas, último aviso recibido, última consulta, estado. */
export function HouseholdsTable(props: HouseholdsTableProps) {
  const { households, selected, onToggle, onToggleAll, canEdit, onEdit } = props;
  if (households.length === 0) {
    return <p className="table-empty">No hay hogares inscritos con estos filtros.</p>;
  }
  const codes = households.map((h) => h.code);
  const allSelected = codes.every((code) => selected.has(code));
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Hogares inscritos</caption>
        <thead>
          <tr>
            <th scope="col" className="cell-check">
              <input
                type="checkbox"
                aria-label="Seleccionar todos los hogares de esta página"
                checked={allSelected}
                onChange={() => onToggleAll(codes, !allSelected)}
              />
            </th>
            <th scope="col">Código</th>
            <th scope="col">Punto</th>
            <th scope="col" className="is-numeric">
              Suscripciones activas
            </th>
            <th scope="col">Último aviso recibido</th>
            <th scope="col">Última consulta</th>
            <th scope="col">Estado</th>
            {canEdit && (
              <th scope="col">
                <span className="visually-hidden">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {households.map((household) => (
            <tr
              key={household.code}
              className={selected.has(household.code) ? 'is-selected' : undefined}
            >
              <td className="cell-check">
                <input
                  type="checkbox"
                  aria-label={`Seleccionar ${household.code}`}
                  checked={selected.has(household.code)}
                  onChange={() => onToggle(household.code)}
                />
              </td>
              <th scope="row" className="num">
                {household.code}
              </th>
              <td className="num">{household.pointCode}</td>
              <td className="is-numeric">
                <Num>{household.activeSubscriptions}</Num>
              </td>
              <td className="num">{formatDateTime(household.lastAlertReceivedAt)}</td>
              <td className="num">{formatDateTime(household.lastAppViewAt)}</td>
              <td>
                <Status
                  tone={household.active ? 'live' : 'none'}
                  label={household.active ? 'Activo' : 'Dado de baja'}
                />
              </td>
              {canEdit && (
                <td className="cell-actions">
                  <button type="button" className="link-button" onClick={() => onEdit(household)}>
                    Editar <span className="visually-hidden">{household.code}</span>
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
