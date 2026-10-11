import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Notice } from '../../shared/ui/Notice';
import { PanelApiError } from '../api/panel-api';
import { errorMessage } from '../components/errors';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../components/use-async';
import { localToday } from '../format';
import { usePanelDeps } from '../panel-deps';
import {
  emptySurvey,
  surveyFromRecord,
  surveyProblemsByField,
  toSurveyInput,
  type SurveyForm,
} from './survey-form';
import { WAVE_LABELS } from './survey-labels';
import { SurveyFormView } from './SurveyForm';

const SURVEY_ERRORS = {
  unknown_household: 'No hay un hogar inscrito con ese código. Revisa el sticker.',
  duplicate_survey: 'Ese hogar ya tiene una encuesta de esta aplicación. Ábrela desde la lista.',
  not_found: 'No se encontró la encuesta. Es posible que la hayan eliminado.',
} as const;

/** `/panel/encuestas/nueva` and `/panel/encuestas/:id`: one Instrument 3 survey. */
export function SurveyEditorPage() {
  const deps = usePanelDeps();
  const { api } = deps;
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useAsync(
    useCallback(() => (id === undefined ? Promise.resolve(null) : api.getSurvey(id)), [api, id]),
  );
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const survey = existing.data ?? null;

  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    setProblems([]);
    try {
      await action();
    } catch (failure) {
      if (failure instanceof PanelApiError && failure.problems.length > 0) {
        setProblems(failure.problems);
      } else {
        setError(errorMessage(failure, SURVEY_ERRORS));
      }
    } finally {
      setWorking(false);
    }
  };

  const save = (form: SurveyForm) => {
    const input = toSurveyInput(form);
    void run(async () => {
      if (survey === null) await api.createSurvey(input);
      else await api.updateSurvey(survey.id, input);
      void navigate('/panel/encuestas', { state: { saved: true } });
    });
  };

  const remove = () => {
    if (survey === null) return;
    if (!window.confirm('¿Eliminar esta encuesta? No se puede deshacer.')) return;
    void run(async () => {
      await api.deleteSurvey(survey.id);
      void navigate('/panel/encuestas');
    });
  };

  const header = (
    <>
      <p className="back-link">
        <Link to="/panel/encuestas">Volver a las encuestas</Link>
      </p>
      <PageHeader
        kicker="Instrumento 3 · encuesta a hogares"
        title={
          survey === null
            ? 'Nueva encuesta'
            : `Encuesta de ${survey.householdCode} · ${WAVE_LABELS[survey.wave]}`
        }
      />
    </>
  );

  if (id !== undefined && survey === null) {
    return (
      <>
        {header}
        {existing.status === 'error' ? (
          <Notice tone="danger" title="No se pudo abrir la encuesta">
            <p>{errorMessage(existing.error, SURVEY_ERRORS)}</p>
          </Notice>
        ) : (
          <p className="panel-loading">Cargando la encuesta…</p>
        )}
      </>
    );
  }

  return (
    <>
      {header}
      {problems.length > 0 && (
        <Notice tone="danger" title="La encuesta tiene respuestas que no cuadran">
          <p>Revisa las preguntas marcadas.</p>
        </Notice>
      )}
      <SurveyFormView
        key={survey?.id ?? 'new'}
        initial={survey === null ? emptySurvey(localToday(deps.now())) : surveyFromRecord(survey)}
        editing={survey !== null}
        problems={surveyProblemsByField(problems)}
        error={error}
        working={working}
        onSubmit={save}
        onDelete={survey === null ? undefined : remove}
      />
    </>
  );
}
