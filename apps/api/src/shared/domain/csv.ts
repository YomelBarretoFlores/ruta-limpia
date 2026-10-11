/**
 * Comma-separated values after RFC 4180: fields separated by commas, records by CRLF (LF and a
 * lone CR are accepted when reading), and fields holding a comma, a quote or a line break quoted
 * with `"` (a quote inside doubled). Pure: no I/O.
 */

/** The byte order mark Excel needs to read a CSV file as UTF-8. */
export const UTF8_BOM = '﻿';

export class CsvSyntaxError extends Error {
  override readonly name = 'CsvSyntaxError';

  constructor(
    readonly line: number,
    readonly problem: 'unterminated_quote' | 'text_after_quote',
  ) {
    super(`CSV syntax error on line ${line}: ${problem}`);
  }
}

/** A record and the (1-based) line it starts on. */
export interface CsvRecord {
  readonly line: number;
  readonly fields: readonly string[];
}

/**
 * Parses CSV text into records, skipping a leading BOM and blank lines. Throws `CsvSyntaxError`
 * for an unterminated quoted field or text after a closing quote.
 */
export function parseCsv(text: string): CsvRecord[] {
  const input = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let i = 0;
  let quotedField = false;

  const endField = () => {
    fields.push(field);
    field = '';
    quotedField = false;
  };
  const endRecord = () => {
    endField();
    const blank = fields.length === 1 && fields[0] === '';
    if (!blank) records.push({ line: recordLine, fields });
    fields = [];
  };

  while (i < input.length) {
    const char = input[i];
    if (char === '"' && field === '' && !quotedField) {
      // A quoted field: read up to the closing quote.
      quotedField = true;
      i += 1;
      for (;;) {
        if (i >= input.length) throw new CsvSyntaxError(recordLine, 'unterminated_quote');
        const inner = input[i];
        if (inner === '"') {
          if (input[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        if (inner === '\n' || (inner === '\r' && input[i + 1] !== '\n')) line += 1;
        field += inner;
        i += 1;
      }
      const next = input[i];
      if (next !== undefined && next !== ',' && next !== '\r' && next !== '\n') {
        throw new CsvSyntaxError(line, 'text_after_quote');
      }
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
    } else if (char === '\r' || char === '\n') {
      endRecord();
      i += char === '\r' && input[i + 1] === '\n' ? 2 : 1;
      line += 1;
      recordLine = line;
    } else {
      field += char;
      i += 1;
    }
  }
  if (field !== '' || fields.length > 0 || quotedField) endRecord();
  return records;
}

export type CsvValue = string | number | boolean | null;

/** Text a spreadsheet would run as a formula: `=`, `+`, `-`, `@`, a tab or a carriage return first. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** The same, behind any number of apostrophes (text `toCsv` neutralized, or authored that way). */
const BEHIND_APOSTROPHES = /^'+[=+\-@\t\r]/;

/**
 * A cell that a spreadsheet would run as a formula gets a leading apostrophe (OWASP, CSV
 * injection). Text that already starts with apostrophes before a formula character gets one more,
 * so `restoreNeutralized` can always drop exactly one. Numbers are written as numbers.
 */
function neutralized(text: string): string {
  return FORMULA_START.test(text) || BEHIND_APOSTROPHES.test(text) ? `'${text}` : text;
}

/**
 * Undoes `toCsv`'s formula neutralization when reading a file back: one apostrophe before a
 * formula character (after any further apostrophes) is dropped. Export → import is lossless for
 * every text, including text the author started with `'=`. A leading apostrophe before anything
 * else (`'90s`) is the author's own and stays. A file edited by hand is read the same way: a typed
 * `'=x` becomes `=x`.
 */
export function restoreNeutralized(text: string): string {
  return BEHIND_APOSTROPHES.test(text) ? text.slice(1) : text;
}

function cell(value: CsvValue): string {
  if (value === null) return '';
  const text = typeof value === 'string' ? neutralized(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Writes records as CSV (CRLF after every record), with the UTF-8 BOM first. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((record) => record.map(cell).join(','));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
