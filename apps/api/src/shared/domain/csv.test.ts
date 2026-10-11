import { describe, expect, it } from 'vitest';

import { CsvSyntaxError, parseCsv, toCsv, UTF8_BOM } from './csv.js';

describe('parseCsv', () => {
  it('reads records with their starting line, skipping the BOM and blank lines', () => {
    const records = parseCsv(`${UTF8_BOM}a,b,c\r\n1,,3\n\n4,5,6`);

    expect(records).toEqual([
      { line: 1, fields: ['a', 'b', 'c'] },
      { line: 2, fields: ['1', '', '3'] },
      { line: 4, fields: ['4', '5', '6'] },
    ]);
  });

  it('reads quoted fields with commas, doubled quotes and line breaks', () => {
    const records = parseCsv(
      'code,note\r\nH-001,"Dijo ""no"", luego sí"\r\nH-002,"dos\r\nlíneas"\r\nH-003,""\r\n',
    );

    expect(records).toEqual([
      { line: 1, fields: ['code', 'note'] },
      { line: 2, fields: ['H-001', 'Dijo "no", luego sí'] },
      { line: 3, fields: ['H-002', 'dos\r\nlíneas'] },
      { line: 5, fields: ['H-003', ''] },
    ]);
  });

  it('keeps a trailing empty field', () => {
    expect(parseCsv('a,b,\n')).toEqual([{ line: 1, fields: ['a', 'b', ''] }]);
  });

  it('reports an unterminated quote and text after a closing quote with the line', () => {
    expect(() => parseCsv('a\n"open,b\n')).toThrow(new CsvSyntaxError(2, 'unterminated_quote'));
    expect(() => parseCsv('a\nb\n"x"y,1')).toThrow(new CsvSyntaxError(3, 'text_after_quote'));
  });
});

describe('toCsv', () => {
  it('writes the BOM, CRLF records and RFC 4180 quoting', () => {
    const text = toCsv(
      ['code', 'note', 'n', 'ok'],
      [
        ['H-001', 'a, "b"', 3, true],
        ['H-002', null, 0.5, false],
      ],
    );

    expect(text).toBe(
      `${UTF8_BOM}code,note,n,ok\r\nH-001,"a, ""b""",3,true\r\nH-002,,0.5,false\r\n`,
    );
  });

  it('neutralizes text cells a spreadsheet would run as formulas, not numbers', () => {
    const text = toCsv(['v'], [['=HYPERLINK("x")'], ['+1'], ['@cmd'], [-3]]);

    expect(text.split('\r\n').slice(1, 5)).toEqual([`"'=HYPERLINK(""x"")"`, "'+1", "'@cmd", '-3']);
  });

  it('round-trips through the parser', () => {
    const rows = [['H-001', 'línea 1\nlínea 2, "citada"', '']];
    const parsed = parseCsv(toCsv(['a', 'b', 'c'], rows));

    expect(parsed.map((r) => r.fields)).toEqual([['a', 'b', 'c'], ...rows]);
  });
});
