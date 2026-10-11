import { Num } from '../../shared/ui/Num';
import { Status } from '../../shared/ui/Status';
import type { AdoptionWeek, Indicator } from '../api/types';
import { formatCalendarDate } from '../format';
import {
  formatChange,
  formatPhases,
  formatPValue,
  formatTarget,
  formatValue,
  incompleteLabel,
  STATUS_LABELS,
} from './indicator-format';

const PHASE_NAMES = { baseline: 'Línea base y salida', pre: 'Pre y post' } as const;
const TEST_NAMES = { wilcoxon: 'Wilcoxon', mcnemar: 'McNemar' } as const;

/** Tabla 16: one row per indicator, its counts, its phases and whether it meets the target. */
export function IndicatorsTable({ indicators }: { readonly indicators: readonly Indicator[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table indicators-table">
        <caption className="visually-hidden">Indicadores de impacto (Tabla 16)</caption>
        <thead>
          <tr>
            <th scope="col">Indicador</th>
            <th scope="col" className="is-numeric">
              Valor
            </th>
            <th scope="col">Meta</th>
            <th scope="col" className="is-numeric">
              Válidos
            </th>
            <th scope="col" className="is-numeric">
              Faltantes
            </th>
            <th scope="col" className="is-numeric">
              Línea base → Salida
            </th>
            <th scope="col" className="is-numeric">
              Cambio
            </th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((indicator) => {
            const status = STATUS_LABELS[indicator.status];
            const incomplete = incompleteLabel(indicator);
            return (
              <tr key={indicator.id}>
                <th scope="row">
                  <span className="cell-block">
                    <span className="num">{indicator.id}</span> · {indicator.name}
                  </span>
                  {indicator.phases !== null && (
                    <span className="cell-sub">{PHASE_NAMES[indicator.phases.before]}</span>
                  )}
                </th>
                <td className="is-numeric">
                  <Num>{formatValue(indicator.value, indicator.unit)}</Num>
                </td>
                <td className="num">{formatTarget(indicator.target, indicator.unit)}</td>
                <td className="is-numeric">
                  <Num>{indicator.nValid}</Num>
                </td>
                <td className="is-numeric">
                  <Num>{indicator.nMissing}</Num>
                  {incomplete !== null && <span className="cell-sub">{incomplete}</span>}
                </td>
                <td className="is-numeric">
                  <Num>{formatPhases(indicator)}</Num>
                </td>
                <td className="is-numeric">
                  <Num>{formatChange(indicator.change, indicator.unit)}</Num>
                </td>
                <td>
                  <Status tone={status.tone} label={status.label} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The paired comparisons of §11.5 (same point or household in both phases). */
export function PairedTestsTable({ indicators }: { readonly indicators: readonly Indicator[] }) {
  const tested = indicators.filter((indicator) => indicator.paired !== null);
  if (tested.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Comparaciones pareadas</caption>
        <thead>
          <tr>
            <th scope="col">Indicador</th>
            <th scope="col">Prueba</th>
            <th scope="col">Unidad del par</th>
            <th scope="col" className="is-numeric">
              Pares
            </th>
            <th scope="col" className="is-numeric">
              Valor p
            </th>
          </tr>
        </thead>
        <tbody>
          {tested.map((indicator) => (
            <tr key={indicator.id}>
              <th scope="row">
                <span className="num">{indicator.id}</span> · {indicator.name}
              </th>
              <td>{indicator.paired === null ? '—' : TEST_NAMES[indicator.paired.kind]}</td>
              <td>{indicator.phases?.before === 'pre' ? 'Hogar' : 'Punto'}</td>
              <td className="is-numeric">
                <Num>{indicator.paired?.pairs ?? 0}</Num>
              </td>
              <td className="is-numeric">
                <Num>{formatPValue(indicator.paired?.pValue ?? null)}</Num>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Adoption week by week (I5): enrolled households and those that used the system. */
export function AdoptionWeeksTable({ weeks }: { readonly weeks: readonly AdoptionWeek[] }) {
  if (weeks.length === 0)
    return <p className="table-empty">No hay hogares inscritos en el periodo.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Adopción por semana</caption>
        <thead>
          <tr>
            <th scope="col">Semana del</th>
            <th scope="col" className="is-numeric">
              Hogares inscritos
            </th>
            <th scope="col" className="is-numeric">
              Con consulta o aviso
            </th>
            <th scope="col" className="is-numeric">
              Con recepción confirmada
            </th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.weekStart}>
              <th scope="row" className="num">
                {formatCalendarDate(week.weekStart)}
              </th>
              <td className="is-numeric">
                <Num>{week.enrolled}</Num>
              </td>
              <td className="is-numeric">
                <Num>{week.active}</Num>
              </td>
              <td className="is-numeric">
                <Num>{week.activeConfirmed}</Num>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
