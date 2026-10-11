import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { PageHeader } from '../components/PageHeader';
import { useFilters } from '../components/use-filters';
import { chosenPeriod, PILOT_PERIODS } from '../indicators/pilot-periods';
import { usePanelDeps } from '../panel-deps';
import { useSelectedRoute } from '../shell/selected-route';

const FILTERS = ['desde', 'hasta'] as const;

/** Which filters each file takes: the route always; the period where it applies. */
interface ExportFile {
  readonly file: string;
  readonly title: string;
  readonly description: string;
  readonly period: boolean;
}

const FILES: readonly ExportFile[] = [
  {
    file: 'instrumento1.csv',
    title: 'Instrumento 1 · registro de recorrido',
    description:
      'Una fila por punto y viaje: inicio, paso real, aviso, ETA comunicado y error (min); incluye la línea base escrita a mano.',
    period: true,
  },
  {
    file: 'instrumento2.csv',
    title: 'Instrumento 2 · fichas de observación',
    description:
      'Una fila por ficha: exposición, bolsas, dispersión, aviso musical y comparabilidad; los observadores por iniciales.',
    period: true,
  },
  {
    file: 'instrumento3.csv',
    title: 'Instrumento 3 · encuestas a hogares',
    description:
      'Una fila por hogar y aplicación, por código de hogar y sin datos personales; se puede volver a importar.',
    period: false,
  },
  {
    file: 'indicadores.csv',
    title: 'Indicadores (Tabla 16)',
    description:
      'Cada indicador con sus fases, sus puntos, válidos y faltantes, el cambio y la prueba pareada.',
    period: true,
  },
  {
    file: 'uso.csv',
    title: 'Uso semanal (adopción)',
    description:
      'Una fila por hogar inscrito y semana: consulta, aviso enviado, recepción confirmada y si cuenta como activo.',
    period: true,
  },
];

/**
 * `/panel/exportaciones`: the CSV files for the analysts, for the selected route and a period
 * (Fase 3 by default). Each is a plain download link: the session cookie goes with it.
 */
export function ExportsPage() {
  const { api } = usePanelDeps();
  const { routeCode } = useSelectedRoute();
  const { values, setFilter, setFilters } = useFilters(FILTERS);
  const { from, to, message: periodProblem } = chosenPeriod(values);

  return (
    <>
      <PageHeader
        title="Exportaciones"
        kicker={`Archivos CSV para el análisis · ${routeCode ?? 'sin ruta'}`}
      />
      <p className="page-note">
        UTF-8, separados por comas, se abren en Excel. Fechas AAAA-MM-DD y horas de Lima. Ningún
        archivo trae direcciones ni datos de las cuentas del panel.
      </p>
      <form
        className="filters"
        role="search"
        aria-label="Elegir el periodo"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="exports-from"
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
          id="exports-to"
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
      {routeCode === null ? (
        <p className="panel-loading">Cargando la ruta…</p>
      ) : periodProblem !== null ? (
        <Notice tone="warn">
          <p>{periodProblem}</p>
        </Notice>
      ) : (
        <ul className="export-list">
          {FILES.map((item) => (
            <li key={item.file} className="export-list__item">
              <div>
                <p className="export-list__title">{item.title}</p>
                <p className="export-list__description">
                  {item.description}{' '}
                  {item.period ? 'Del periodo elegido.' : 'Todas las de la ruta.'}
                </p>
              </div>
              <a
                className="button button--secondary button--compact"
                href={api.exportUrl(
                  item.file,
                  item.period ? { route: routeCode, from, to } : { route: routeCode },
                )}
                download
              >
                {/* One text node: a flex button would drop the space before an element. */}
                <span>
                  Descargar <span className="num">{item.file}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
