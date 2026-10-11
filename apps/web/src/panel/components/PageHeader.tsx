import type { ReactNode } from 'react';

export interface PageHeaderProps {
  readonly title: string;
  /** A context line above the title, for example "Zona urbana de Independencia · RI-01". */
  readonly kicker?: ReactNode;
  /** Buttons at the right (the page's actions). */
  readonly actions?: ReactNode;
}

/** The page's title row: flat, left-aligned, actions at the right. */
export function PageHeader({ title, kicker, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        {kicker !== undefined && <p className="page-header__kicker">{kicker}</p>}
        <h1 className="page-header__title">{title}</h1>
      </div>
      {actions !== undefined && <div className="page-header__actions no-print">{actions}</div>}
    </header>
  );
}
