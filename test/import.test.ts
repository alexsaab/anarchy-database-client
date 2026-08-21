import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImportService } from '../src/import/ImportService.js';

test('splits csv fields, honouring quotes and doubled quotes', () => {
  assert.deepEqual(ImportService.parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(ImportService.parseCsvLine('"a,b",c'), ['a,b', 'c']);
  assert.deepEqual(ImportService.parseCsvLine('"say ""hi""",x'), ['say "hi"', 'x']);
  assert.deepEqual(ImportService.parseCsvLine('a,,c'), ['a', '', 'c']);
  assert.deepEqual(ImportService.parseCsvLine('"trailing empty",'), ['trailing empty', '']);
});

test('detects the delimiter', () => {
  assert.equal(ImportService.detectDelimiter('a,b,c'), ',');
  assert.equal(ImportService.detectDelimiter('a;b;c;d'), ';');
  assert.equal(ImportService.detectDelimiter('a\tb\tc\td\te'), '\t');
});

test('parses a csv document into headers and rows', () => {
  const sheet = ImportService.parseCsv('id,name\n1,Ada\n2,"Bob, Jr."\n');
  assert.deepEqual(sheet.headers, ['id', 'name']);
  assert.equal(sheet.rows.length, 2);
  assert.deepEqual(sheet.rows[1], ['2', 'Bob, Jr.']);
});

test('a newline inside a quoted field does not split the row', () => {
  const sheet = ImportService.parseCsv('id,note\n1,"line one\nline two"\n2,plain\n');
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[0][1], 'line one\nline two');
  assert.equal(sheet.rows[1][1], 'plain');
});

test('handles CRLF line endings', () => {
  const sheet = ImportService.parseCsv('id,name\r\n1,Ada\r\n');
  assert.deepEqual(sheet.headers, ['id', 'name']);
  assert.deepEqual(sheet.rows[0], ['1', 'Ada']);
});

test('empty cells become NULL, not empty strings', () => {
  assert.equal(ImportService.coerce('', { name: 'a', type: 'TEXT' } as any), null);
  assert.equal(ImportService.coerce(null, { name: 'a', type: 'TEXT' } as any), null);
  assert.equal(ImportService.coerce(undefined, { name: 'a', type: 'INTEGER' } as any), null);
});

test('numeric columns receive numbers, not numeric strings', () => {
  assert.equal(ImportService.coerce('42', { name: 'n', type: 'INTEGER' } as any), 42);
  assert.equal(ImportService.coerce('12.5', { name: 'n', type: 'NUMERIC(10,2)' } as any), 12.5);
  assert.equal(ImportService.coerce('1 234', { name: 'n', type: 'BIGINT' } as any), 1234);
  assert.equal(ImportService.coerce('12,5', { name: 'n', type: 'REAL' } as any), 12.5, 'comma decimal separator');
  // Not a number: pass it through so the database reports the real problem.
  assert.equal(ImportService.coerce('abc', { name: 'n', type: 'INTEGER' } as any), 'abc');
});

test('boolean columns accept the usual spellings', () => {
  const col = { name: 'b', type: 'BOOLEAN' } as any;
  for (const v of ['true', 'TRUE', 't', 'yes', 'Y', '1']) assert.equal(ImportService.coerce(v, col), true, v);
  for (const v of ['false', 'f', 'no', 'N', '0']) assert.equal(ImportService.coerce(v, col), false, v);
});

test('text columns keep their value untouched', () => {
  assert.equal(ImportService.coerce('0042', { name: 's', type: 'VARCHAR' } as any), '0042');
  assert.equal(ImportService.coerce('true', { name: 's', type: 'TEXT' } as any), 'true');
});

test('reads an xlsx workbook back into headers and rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const file = path.join(dir, 'in.xlsx');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('data');
    ws.addRow(['id', 'name', 'score']);
    ws.addRow([1, 'Ada', 7.5]);
    ws.addRow([2, 'Bob', null]);
    ws.addRow([]);                        // blank row must be skipped
    await wb.xlsx.writeFile(file);

    const sheet = await ImportService.parseXlsx(file);
    assert.deepEqual(sheet.headers, ['id', 'name', 'score']);
    assert.equal(sheet.rows.length, 2, 'the blank row should be dropped');
    assert.deepEqual(sheet.rows[0], [1, 'Ada', 7.5]);
    assert.equal(sheet.rows[1][2], null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
