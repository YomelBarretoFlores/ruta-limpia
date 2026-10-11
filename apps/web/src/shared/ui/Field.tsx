import type { ReactNode } from 'react';

/** The attributes the control inside a `Field` must carry. */
export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
}

export interface FieldProps {
  /** The control's id; the label points to it. */
  readonly id: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  /** When given, the group gets a 4 px danger bar and the message is read with the control. */
  readonly error?: ReactNode;
  /** Renders the control with the given id and descriptions. */
  readonly control: (props: FieldControlProps) => ReactNode;
}

/** A labelled form control: label above, hint under the label, error message above the control. */
export function Field({ id, label, hint, error, control }: FieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={error === undefined ? 'field' : 'field field--error'}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint !== undefined && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
      {control({
        id,
        ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
        ...(error === undefined ? {} : { 'aria-invalid': true as const }),
      })}
    </div>
  );
}
