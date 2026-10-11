import type { Role } from '../domain/role.js';

/** The signed-in panel user performing a use case (for permission checks and the audit trail). */
export interface PanelActor {
  readonly userId: string;
  readonly role: Role;
}
