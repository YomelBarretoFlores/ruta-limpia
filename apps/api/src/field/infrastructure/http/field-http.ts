import type { PanelAccess } from '../../../auth/infrastructure/http/panel-guard.js';
import { OWN_RECORD_EDIT_WINDOW_HOURS } from '../../domain/field-record-access.js';

/** Shared HTTP pieces of the field record routes (observation sheets, baseline logs). */

export const FIELD_READ: PanelAccess = { anyOf: ['field:read_own', 'field:read_all'] };
export const FIELD_WRITE: PanelAccess = { anyOf: ['field:write_own', 'field:write_all'] };

/** Blank optional texts are stored as null. */
export function blankToNull(text: string | null): string | null {
  return text === null || text === '' ? null : text;
}

/** The `edit_window_closed` message, quoting the policy's window. */
export function editWindowClosedMessage(records: string): string {
  return `${records} can be changed by their author for ${OWN_RECORD_EDIT_WINDOW_HOURS} hours only.`;
}
