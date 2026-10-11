import type { ReactNode } from 'react';

export interface CardProps {
  /** Id of the section, also used to label it. */
  readonly id: string;
  readonly title: string;
  readonly subtitle?: ReactNode;
  /** Shown at the right of the title (for example a status badge). */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}

/** A titled section of the page. */
export function Card({ id, title, subtitle, aside, children }: CardProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="card" aria-labelledby={titleId}>
      <header className="card__header">
        <div>
          <h2 id={titleId} className="card__title" tabIndex={-1}>
            {title}
          </h2>
          {subtitle !== undefined && <p className="card__subtitle">{subtitle}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
