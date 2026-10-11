import type { ReactNode } from 'react';

export interface SectionProps {
  /** Id of the section, also used to label it (the title gets `${id}-title`). */
  readonly id: string;
  readonly title: string;
  /** A short context line above the title, for example "Independencia · tramo RI-01". */
  readonly kicker?: ReactNode;
  /** Shown at the right of the title (for example a connection status). */
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}

/**
 * A titled part of a page: white surface, hairline rule, small radius, no shadow. The title can
 * take the keyboard focus (`tabIndex={-1}`) so a link or button can move the reader to it.
 */
export function Section({ id, title, kicker, aside, children }: SectionProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="section" aria-labelledby={titleId}>
      <header className="section__header">
        <div>
          {kicker !== undefined && <p className="section__kicker">{kicker}</p>}
          <h2 id={titleId} className="section__title" tabIndex={-1}>
            {title}
          </h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
