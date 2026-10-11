import type { UnitOfWork } from '../../src/shared/application/unit-of-work.js';

/**
 * Runs the work directly on in-memory ports. It cannot roll back: failure atomicity is proved by
 * the PostGIS integration tests, which use the real transactional unit of work.
 */
export class ImmediateUnitOfWork<Ports> implements UnitOfWork<Ports> {
  constructor(private readonly ports: Ports) {}

  run<T>(work: (ports: Ports) => Promise<T>): Promise<T> {
    return work(this.ports);
  }
}
