import type { CsvValue } from '../../shared/domain/csv.js';

/** A table to write as CSV: its header and its rows, in header order. */
export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly CsvValue[])[];
}

/** Optional filters of an instrument export: a route and an inclusive period of local dates. */
export interface ExportFilter {
  readonly routeCode?: string;
  /** `YYYY-MM-DD`, America/Lima. */
  readonly from?: string;
  readonly to?: string;
}

/**
 * Port: the instrument logs as export tables. Dates are ISO (`YYYY-MM-DD`), times of day are
 * America/Lima `HH:MM`, booleans `yes`/`no`; no personal data (no addresses, no user accounts:
 * observers appear as written on the sheet).
 */
export interface InstrumentExports {
  /** Instrument 1: the system's trip log and the hand-written baseline logs. */
  instrument1(filter: ExportFilter): Promise<CsvTable>;
  /** Instrument 2: the point observation sheets. */
  instrument2(filter: ExportFilter): Promise<CsvTable>;
}
