import { useState, type FormEvent } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';
import { Num } from '../../shared/ui/Num';
import type { ImportRowError, SurveyImport } from '../api/types';
import { importProblemLabel } from './survey-labels';

export type ImportOutcome =
  | { readonly status: 'imported'; readonly result: SurveyImport }
  | {
      readonly status: 'refused';
      readonly message: string;
      readonly errors: readonly ImportRowError[];
    };

export interface SurveyImportProps {
  readonly templateUrl: string;
  readonly working: boolean;
  readonly outcome: ImportOutcome | null;
  readonly onImport: (file: File) => void;
}

/**
 * The CSV import of Instrument 3: the template, the file, and what happened. The import is all or
 * nothing, so a refused file lists every problem by line and nothing is saved.
 */
export function SurveyImportPanel({ templateUrl, working, outcome, onImport }: SurveyImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (file !== null) onImport(file);
  };

  return (
    <section className="panel-section" aria-labelledby="survey-import-title">
      <h2 id="survey-import-title" className="panel-section__title">
        Importar encuestas desde un archivo CSV
      </h2>
      <p className="panel-section__note">
        Una fila por hogar y aplicación. Si el hogar ya tiene esa aplicación, la fila la reemplaza.
        Si alguna fila tiene un problema, no se importa ninguna.{' '}
        <a href={templateUrl} download>
          Descargar plantilla
        </a>
      </p>
      <form className="filters" onSubmit={submit} noValidate>
        <Field
          id="survey-import-file"
          label="Archivo CSV"
          error={checked && file === null ? 'Elige el archivo a importar.' : undefined}
          control={(control) => (
            <input
              {...control}
              className="input"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          )}
        />
        <Button type="submit" className="button--compact" disabled={working}>
          {working ? 'Importando…' : 'Importar archivo'}
        </Button>
      </form>
      {outcome?.status === 'imported' && (
        <Notice tone="info">
          <p>
            Se importaron {outcome.result.created + outcome.result.updated} encuestas:{' '}
            {outcome.result.created} nuevas y {outcome.result.updated} reemplazadas.
          </p>
        </Notice>
      )}
      {outcome?.status === 'refused' && (
        <>
          <Notice tone="danger" title="No se importó ninguna encuesta">
            <p>{outcome.message}</p>
          </Notice>
          {outcome.errors.length > 0 && <ImportErrorsTable errors={outcome.errors} />}
        </>
      )}
    </section>
  );
}

/** Every problem of the file: its line, its column and what to fix. */
export function ImportErrorsTable({ errors }: { readonly errors: readonly ImportRowError[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Problemas del archivo</caption>
        <thead>
          <tr>
            <th scope="col" className="is-numeric">
              Línea
            </th>
            <th scope="col">Columna</th>
            <th scope="col">Problema</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((error, index) => (
            <tr key={`${error.line}-${error.column ?? ''}-${index}`}>
              <th scope="row" className="is-numeric">
                <Num>{error.line}</Num>
              </th>
              <td className="num">{error.column ?? 'Toda la fila'}</td>
              <td>{importProblemLabel(error.problem)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
