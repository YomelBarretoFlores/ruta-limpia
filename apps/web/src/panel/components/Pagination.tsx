import { Num } from '../../shared/ui/Num';

export interface PaginationProps {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onPage: (page: number) => void;
}

/** "Página 2 de 5 · 87 registros", with the previous and next pages. */
export function Pagination({ page, pageSize, total, onPage }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pagination" aria-label="Paginación">
      <p className="pagination__status">
        Página <Num>{page}</Num> de <Num>{pages}</Num> · <Num>{total}</Num>{' '}
        {total === 1 ? 'registro' : 'registros'}
      </p>
      <div className="pagination__buttons">
        <button
          type="button"
          className="button button--secondary button--compact"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="button button--secondary button--compact"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}
