import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'warn' | 'danger';

export interface NoticeProps {
  /** `info`: accent bar; `warn`: stale or pending; `danger`: an error or a lost signal. */
  readonly tone: NoticeTone;
  /** An optional bold first line. */
  readonly title?: ReactNode;
  /**
   * Announce the notice to screen readers when it appears (default). `danger` notices are
   * announced at once (`alert`), the others politely (`status`).
   */
  readonly announce?: boolean;
  readonly children?: ReactNode;
}

/** Inset text with a 4 px left bar in the tone's color, on its tint. No icons. */
export function Notice({ tone, title, announce = true, children }: NoticeProps) {
  const role = !announce ? undefined : tone === 'danger' ? 'alert' : 'status';
  return (
    <div className={`notice notice--${tone}`} role={role}>
      {title !== undefined && <p className="notice__title">{title}</p>}
      {children}
    </div>
  );
}
