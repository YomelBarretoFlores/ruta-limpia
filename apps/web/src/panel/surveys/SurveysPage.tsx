import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { PanelApiError } from '../api/panel-api';
import { SURVEY_WAVES, type Survey, type SurveyWave } from '../api/types';
import { errorMessage } from '../components/errors';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { useAsync } from '../components/use-async';
import { useFilters } from '../components/use-filters';
import { formatCalendarDate } from '../format';
import { usePanelDeps } from '../panel-deps';
import { canAny } from '../session/permissions';
import { useUser } from '../session/session-context';
import { useSelectedRoute } from '../shell/selected-route';
import { LEAD_TIME_LABELS, WAVE_LABELS } from './survey-labels';
import { SurveyImportPanel, type ImportOutcome } from './SurveyImport';

const PAGE_SIZE = 20;
const FILTERS = ['aplicacion', 'hogar'] as const;

const IMPORT_ERRORS = {
  invalid_csv: 'El archivo no tiene el formato de la plantilla. Revisa los problemas de la tabla.',
  invalid_rows: 'Corrige las filas de la tabla y vuelve a importar el archivo completo.',
  empty_file: 'El archivo no tiene filas de encuestas.',
  too_many_rows: 'El archivo tiene demasiadas filas. Divídelo en archivos de hasta 1000 filas.',
} as const;

/** Reads a chosen file as text (UTF-8), with or without `Blob.text`. */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/** `/panel/encuestas`: the Instrument 3 surveys of the route, new ones and the CSV import. */
export function SurveysPage() {
  const { api } = usePanelDeps();
  const user = useUser();
  const { routeCode } = useSelectedRoute();
  const saved = (useLocation().state as { saved?: boolean } | null)?.saved === true;
  const { values, page, setFilter, setPage } = useFilters(FILTERS);
  const { aplicacion, hogar } = values;
  const load = useCallback(
    () =>
      routeCode === null
        ? Promise.resolve(undefined)
        : api.listSurveys({
            route: routeCode,
            wave: aplicacion === '' ? undefined : (aplicacion as SurveyWave),
            household: hogar.trim() === '' ? undefined : hogar.trim().toUpperCase(),
            page,
            pageSize: PAGE_SIZE,
          }),
    [api, routeCode, aplicacion, hogar, page],
  );
  const surveys = useAsync(load);
  const canWrite = canAny(user, ['surveys:write']);
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const importFile = (file: File) => {
    setImporting(true);
    setOutcome(null);
    void (async () => {
      try {
        const result = await api.importSurveys(await readText(file));
        setOutcome({ status: 'imported', result });
        surveys.reload();
      } catch (failure) {
        setOutcome({
          status: 'refused',
          message: errorMessage(failure, IMPORT_ERRORS),
          errors: failure instanceof PanelApiError ? failure.rowErrors : [],
        });
      } finally {
        setImporting(false);
      }
    })();
  };

  return (
    <>
      <PageHeader
        title="Encuestas"
        kicker="Instrumento 3 · encuesta a hogares, pre y post"
        actions={
          canWrite && (
            <Link className="button button--primary button--compact" to="/panel/encuestas/nueva">
              Nueva encuesta
            </Link>
          )
        }
      />
      {saved && (
        <Notice tone="info">
          <p>Se guardó la encuesta.</p>
        </Notice>
      )}
      <form
        className="filters"
        role="search"
        aria-label="Filtrar encuestas"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field
          id="surveys-wave"
          label="Aplicación"
          control={(control) => (
            <select
              {...control}
              className="select"
              value={aplicacion}
              onChange={(e) => setFilter('aplicacion', e.target.value)}
            >
              <option value="">Pre y post</option>
              {SURVEY_WAVES.map((wave) => (
                <option key={wave} value={wave}>
                  {WAVE_LABELS[wave]}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          id="surveys-household"
          label="Hogar"
          control={(control) => (
            <input
              {...control}
              className="input"
              placeholder="H-001"
              value={hogar}
              onChange={(e) => setFilter('hogar', e.target.value)}
            />
          )}
        />
      </form>
      {surveys.data === undefined ? (
        <LoadState
          status={surveys.status}
          error={surveys.error}
          onRetry={surveys.reload}
          what="las encuestas"
        />
      ) : (
        <>
          <SurveysTable surveys={surveys.data.items} />
          <Pagination
            page={surveys.data.page}
            pageSize={surveys.data.pageSize}
            total={surveys.data.total}
            onPage={setPage}
          />
        </>
      )}
      {canWrite && (
        <SurveyImportPanel
          templateUrl={api.surveyTemplateUrl()}
          working={importing}
          outcome={outcome}
          onImport={importFile}
        />
      )}
    </>
  );
}

function SurveysTable({ surveys }: { readonly surveys: readonly Survey[] }) {
  if (surveys.length === 0)
    return <p className="table-empty">No hay encuestas con estos filtros.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Encuestas a hogares</caption>
        <thead>
          <tr>
            <th scope="col">Hogar</th>
            <th scope="col">Aplicación</th>
            <th scope="col">Fecha</th>
            <th scope="col">Saca sus residuos</th>
            <th scope="col" className="is-numeric">
              Satisfacción
            </th>
            <th scope="col">Origen</th>
            <th scope="col">
              <span className="visually-hidden">Abrir</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {surveys.map((survey) => (
            <tr key={survey.id}>
              <th scope="row" className="num">
                {survey.householdCode}
              </th>
              <td>{WAVE_LABELS[survey.wave]}</td>
              <td className="num">{formatCalendarDate(survey.surveyedOn)}</td>
              <td>{survey.leadTime === null ? '—' : LEAD_TIME_LABELS[survey.leadTime]}</td>
              <td className="is-numeric num">{survey.satisfaction ?? '—'}</td>
              <td className="cell-muted">
                {survey.importBatchId === null ? 'Panel' : 'Archivo CSV'}
              </td>
              <td className="cell-actions">
                <Link to={`/panel/encuestas/${survey.id}`}>
                  Abrir{' '}
                  <span className="visually-hidden">
                    la encuesta {WAVE_LABELS[survey.wave]} de {survey.householdCode}
                  </span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
