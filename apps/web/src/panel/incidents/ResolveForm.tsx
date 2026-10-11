import { useState, type FormEvent } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field } from '../../shared/ui/Field';
import { Notice } from '../../shared/ui/Notice';

/** Resolving an incident says how it was resolved; the note stays with it. */
export function ResolveForm({
  onResolve,
  onCancel,
  describeError,
}: {
  readonly onResolve: (note: string) => Promise<void>;
  readonly onCancel: () => void;
  readonly describeError: (error: unknown) => string;
}) {
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (note.trim() === '') return;
    setWorking(true);
    setError(null);
    try {
      await onResolve(note.trim());
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={(event) => void submit(event)} noValidate>
      {error !== null && (
        <div className="form-wide">
          <Notice tone="danger">
            <p>{error}</p>
          </Notice>
        </div>
      )}
      <div className="form-wide">
        <Field
          id="resolution-note"
          label="Cómo se resolvió"
          error={
            checked && note.trim() === '' ? 'Escribe cómo se resolvió la incidencia.' : undefined
          }
          control={(control) => (
            <textarea
              {...control}
              className="input"
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        />
      </div>
      <div className="form-actions">
        <Button type="submit" className="button--compact" disabled={working}>
          Marcar como resuelta
        </Button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
