import type { UnitOfWork } from '../../application/unit-of-work.js';
import type { AppDatabase } from './database.js';

/**
 * Runs `work` inside the transaction `db` already is, or in a new one. Stores use it for their
 * own multi-statement writes, so they also work when a unit of work hands them a transaction.
 */
export function inTransaction<T>(
  db: AppDatabase,
  work: (trx: AppDatabase) => Promise<T>,
): Promise<T> {
  return db.isTransaction ? work(db) : db.transaction().execute(work);
}

/** A unit of work over one PostgreSQL transaction; `bind` builds the ports on that transaction. */
export class KyselyUnitOfWork<Ports> implements UnitOfWork<Ports> {
  constructor(
    private readonly db: AppDatabase,
    private readonly bind: (trx: AppDatabase) => Ports,
  ) {}

  run<T>(work: (ports: Ports) => Promise<T>): Promise<T> {
    return inTransaction(this.db, (trx) => work(this.bind(trx)));
  }
}
