import { can, type Role } from '../../auth/domain/role.js';

/** Users with only the `_own` field permissions may edit their records for this long. */
export const OWN_RECORD_EDIT_WINDOW_HOURS = 24;

/** Who created a field record (observation sheet, baseline log), and when. */
export interface FieldRecordOwnership {
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
}

export function canReadFieldRecord(
  role: Role,
  userId: string,
  record: FieldRecordOwnership,
): boolean {
  if (can(role, 'field:read_all')) return true;
  return can(role, 'field:read_own') && record.createdByUserId === userId;
}

export type FieldEditVerdict = 'allowed' | 'not_owner' | 'edit_window_closed';

/** Edit and delete rights: everyone's records with `field:write_all`, else one's own within 24 h. */
export function fieldEditVerdict(
  role: Role,
  userId: string,
  record: FieldRecordOwnership,
  now: Date,
): FieldEditVerdict {
  if (can(role, 'field:write_all')) return 'allowed';
  if (!can(role, 'field:write_own') || record.createdByUserId !== userId) return 'not_owner';
  const ageMs = now.getTime() - record.createdAt.getTime();
  return ageMs < OWN_RECORD_EDIT_WINDOW_HOURS * 3_600_000 ? 'allowed' : 'edit_window_closed';
}
