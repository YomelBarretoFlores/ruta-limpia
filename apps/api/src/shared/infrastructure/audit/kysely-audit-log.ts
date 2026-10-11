import type {
  AuditEvent,
  AuditLog,
  AuditQuery,
  AuditTrail,
  RecordedAuditEvent,
} from '../../application/audit-log.js';
import type { AppDatabase } from '../db/database.js';

/** The audit trail in PostgreSQL (`audit_events`, append-only). */
export class KyselyAuditLog implements AuditLog, AuditTrail {
  constructor(private readonly db: AppDatabase) {}

  async record(event: AuditEvent): Promise<void> {
    await this.db
      .insertInto('audit_events')
      .values({
        user_id: event.userId,
        action: event.action,
        entity: event.entity,
        entity_id: event.entityId,
        at: event.at,
        details: JSON.stringify(event.details ?? {}),
      })
      .execute();
  }

  async list(query: AuditQuery): Promise<{ items: RecordedAuditEvent[]; total: number }> {
    let base = this.db.selectFrom('audit_events as a');
    if (query.entity !== undefined) base = base.where('a.entity', '=', query.entity);
    if (query.entityId !== undefined) base = base.where('a.entity_id', '=', query.entityId);
    const [rows, count] = await Promise.all([
      base
        .leftJoin('users as u', 'u.id', 'a.user_id')
        .select([
          'a.id',
          'a.user_id',
          'a.action',
          'a.entity',
          'a.entity_id',
          'a.at',
          'a.details',
          'u.username',
        ])
        .orderBy('a.at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(query.limit)
        .offset(query.offset)
        .execute(),
      base.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow(),
    ]);
    return {
      total: Number(count.total),
      items: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        username: row.username,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        at: row.at,
        details: row.details,
      })),
    };
  }
}
