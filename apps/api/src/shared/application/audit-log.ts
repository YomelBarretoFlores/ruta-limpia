/**
 * One audited action of the panel. `details` must never hold secrets (passwords, tokens, session
 * ids) nor personal data: ids, codes, changed field names and reasons only.
 */
export interface AuditEvent {
  /** The acting panel user; null when unknown (for example a failed login of an unknown name). */
  readonly userId: string | null;
  /** `<entity>.<verb>`, for example `auth.login_succeeded` or `household.updated`. */
  readonly action: string;
  readonly entity: string;
  readonly entityId: string | null;
  readonly at: Date;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Port: append-only audit trail. */
export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
}

/** A recorded audit event, as the administrators' audit view lists it. */
export interface RecordedAuditEvent extends AuditEvent {
  readonly id: string;
  /** The acting user's username, when the user still exists. */
  readonly username: string | null;
}

export interface AuditQuery {
  readonly entity?: string;
  readonly entityId?: string;
  readonly limit: number;
  readonly offset: number;
}

/** Port: reads the audit trail, newest first. */
export interface AuditTrail {
  list(
    query: AuditQuery,
  ): Promise<{ readonly items: RecordedAuditEvent[]; readonly total: number }>;
}
