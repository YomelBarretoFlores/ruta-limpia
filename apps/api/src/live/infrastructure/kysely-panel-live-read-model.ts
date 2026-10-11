import type { AppDatabase } from '../../shared/infrastructure/db/database.js';
import type { OpenIncident, PanelLiveReadModel } from '../application/panel-live-service.js';
import type { PointDeliveryStats } from '../application/panel-live-views.js';

/** Alert delivery counts and open incidents for the live panel, from PostgreSQL. */
export class KyselyPanelLiveReadModel implements PanelLiveReadModel {
  constructor(private readonly db: AppDatabase) {}

  async deliveryStats(tripIds: readonly string[]): Promise<PointDeliveryStats[]> {
    if (tripIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('alerts as a')
      .select([
        'a.trip_id',
        'a.point_id',
        'a.recipients_count',
        'a.delivered_count',
        'a.failed_count',
      ])
      .select((eb) =>
        eb
          .selectFrom('alert_deliveries as d')
          .select((sub) => sub.fn.countAll<string>().as('n'))
          .whereRef('d.alert_id', '=', 'a.id')
          .where('d.received_at', 'is not', null)
          .as('receipts'),
      )
      .where('a.trip_id', 'in', tripIds)
      .execute();
    return rows.map((row) => ({
      tripId: row.trip_id,
      pointId: row.point_id,
      recipients: row.recipients_count,
      delivered: row.delivered_count,
      receiptsReceived: Number(row.receipts ?? 0),
      failed: row.failed_count,
    }));
  }

  async openIncidents(routeId: string): Promise<OpenIncident[]> {
    const rows = await this.db
      .selectFrom('incidents as i')
      .leftJoin('reference_points as p', 'p.id', 'i.point_id')
      .select(['i.id', 'i.kind', 'i.trip_id', 'p.code', 'i.description', 'i.occurred_at'])
      .where('i.route_id', '=', routeId)
      .where('i.resolved_at', 'is', null)
      .orderBy('i.occurred_at', 'desc')
      .limit(50)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      tripId: row.trip_id,
      pointCode: row.code,
      description: row.description,
      occurredAt: row.occurred_at,
    }));
  }
}
