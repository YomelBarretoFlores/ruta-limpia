/**
 * Port: runs work atomically. `work` receives ports bound to one transaction, so either everything
 * it wrote commits or nothing does. Use cases record an audit event through these ports in the
 * same unit as the change it describes: a failed audit write undoes the change, and a committed
 * change always has its audit event.
 */
export interface UnitOfWork<Ports> {
  run<T>(work: (ports: Ports) => Promise<T>): Promise<T>;
}
