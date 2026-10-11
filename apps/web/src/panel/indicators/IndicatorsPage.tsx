import { useCallback } from 'react';

import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { useFilters } from '../components/use-filters';
import { formatCalendarDate, formatDateTime } from '../format';
import { usePanelDeps } from '../panel-deps';
import { useSelectedRoute } from '../shell/selected-route';
import { AdoptionWeeksTable, IndicatorsTable, PairedTestsTable } from './IndicatorsTable';
import { PHASE_3, PILOT_PERIODS } from './pilot-periods';

const FILTERS = ['desde', 'hasta'] as const;

/**
 * `/panel/indicadores`: Tabla 16 for the selected route and a period (Fase 3 by default). The
 * field and survey indicators compare their own phases; the period selects the system's logs.
 */
export function IndicatorsPage() {
  const { api } = usePanelDeps();
  const { routeCode } = useSelectedRoute();
  const { values, setFilter, setFilters } = useFilters(FILTERS);
  const from = values.desde === '' ? PHASE_3.from : values.desde;
  const to = values.hasta === '' ? PHASE_3.to : values.hasta;
  const reversed = from > to;
  const load = useCallback(
    () =>
      routeCode === null || reversed
        ? Promise.resolve(undefined)
        : api.getIndicators({ route: routeCode, from, to }),
    [api, routeCode, from, to, reversed],
  );
  const report = useAsync(load);

  return (
    <>
      <PageHeader
        title="Indicadores"
        kicker={`Tabla 16 · ${routeCode ?? 'sin ruta'} · ${formatCalendarDate(from)} al ${formatCalendarDate(to)}`}
      />
      <form
        className="filters"
        role="search"
        aria-label="Elegir el periodo"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="indicators-from"
          label="Desde"
          control={(control) => (
            <input
              {...control}
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFilter('desde', e.target.value)}
            />
          )}
        />
        <Field
          id="indicators-to"
          label="Hasta"
          control={(control) => (
            <input
              {...control}
              className="input"
              type="date"
              value={to}
              onChange={(e) => setFilter('hasta', e.target.value)}
            />
          )}
        />
        <div className="filters__presets">
          {PILOT_PERIODS.map((period) => (
            <button
              key={period.label}
              type="button"
              className="link-button"
              aria-pressed={period.from === from && period.to === to}
              onClick={() => setFilters({ desde: period.from, hasta: period.to })}
            >
              {period.label}
            </button>
          ))}
        </div>
      </form>
      <p className="page-note">
        El periodo elige los registros del sistema (precisión, adopción, disponibilidad).
        Exposición, dispersión y aviso musical comparan las fichas de línea base y salida; las
        encuestas comparan pre y post.
      </p>
      {reversed ? (
        <Notice tone="warn">
          <p>La fecha «Desde» es posterior a «Hasta». Corrige el periodo.</p>
        </Notice>
      ) : report.data === undefined ? (
        <LoadState
          status={report.status}
          error={report.error}
          onRetry={report.reload}
          what="los indicadores"
        />
      ) : (
        <>
          <IndicatorsTable indicators={report.data.indicators} />
          <p className="page-note page-note--after">
            Calculado el {formatDateTime(report.data.generatedAt)}. Si la línea base es 0, se
            informa el cambio absoluto y la meta queda sin evaluar.
          </p>
          <section className="panel-section" aria-labelledby="paired-title">
            <h2 id="paired-title" className="panel-section__title">
              Comparaciones pareadas
            </h2>
            <PairedTestsTable indicators={report.data.indicators} />
          </section>
          <section className="panel-section" aria-labelledby="adoption-title">
            <h2 id="adoption-title" className="panel-section__title">
              Adopción por semana
            </h2>
            <AdoptionWeeksTable weeks={report.data.adoptionWeeks} />
          </section>
        </>
      )}
    </>
  );
}
