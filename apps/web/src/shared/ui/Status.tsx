export type StatusTone = 'live' | 'stale' | 'lost' | 'none';

export interface StatusProps {
  /** `live`: accent; `stale`: warn; `lost`: danger; `none`: neutral. */
  readonly tone: StatusTone;
  /** The state in words (color is never the only cue). */
  readonly label: string;
  /** Announce changes politely to screen readers. */
  readonly announce?: boolean;
}

/** A state shown as text with an 8 px square swatch, never as a colored pill. */
export function Status({ tone, label, announce = false }: StatusProps) {
  return (
    <span className={`status status--${tone}`} role={announce ? 'status' : undefined}>
      <span className="status__swatch" aria-hidden="true" />
      {label}
    </span>
  );
}
