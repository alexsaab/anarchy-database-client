import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExportService } from '../src/export/ExportService.js';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vscodeStub = require('vscode');

const svc = ExportService as any;

test('sheet names drop characters Excel forbids and fit 31 chars', () => {
  assert.equal(svc.sheetName('users/report:2026*'), 'users_report_2026_');
  assert.equal(svc.sheetName('a'.repeat(50)).length, 31);
  assert.equal(svc.sheetName(''), 'Sheet1');
  assert.equal(svc.sheetName('[x]:y?z/w\\v'), '_x__y_z_w_v');
});

test('cell values keep their native type', () => {
  assert.equal(svc.cellValue(42), 42);
  assert.equal(svc.cellValue(true), true);
  assert.equal(svc.cellValue(null), null);
  assert.equal(svc.cellValue(undefined), null);
  const d = new Date('2026-08-21T10:00:00Z');
  assert.equal(svc.cellValue(d), d);
});

test('bigints stay exact beyond the safe integer range', () => {
  assert.equal(svc.cellValue(BigInt(42)), 42);
  assert.equal(svc.cellValue(BigInt('9007199254740995')), '9007199254740995');
});

test('buffers and objects are stringified', () => {
  assert.equal(svc.cellValue(Buffer.from('hi')), '6869');
  assert.equal(svc.cellValue({ a: 1 }), '{"a":1}');
});

test('over-long strings are truncated to Excel cell limit', () => {
  const out = svc.cellValue('x'.repeat(40000));
  assert.equal(out.length, 32767);
  assert.ok(out.endsWith('…'));
});

test('writes a workbook Excel can open, with typed cells', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
  const file = path.join(dir, 'out.xlsx');
  try {
    vscodeStub.__recorded.saveDialogPath = file;
    const result: any = {
      fields: [{ name: 'id' }, { name: 'name' }, { name: 'score' }],
      rows: [
        { id: 1, name: 'Ada', score: 7.5 },
        { id: 2, name: null, score: null },
      ],
      costTimeMs: 1,
    };
    await ExportService.exportData('users', result, 'xlsx');
    assert.ok(fs.existsSync(file), 'no workbook written');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    assert.equal(ws.name, 'users');
    assert.equal(ws.rowCount, 3);
    assert.equal(ws.getRow(1).font.bold, true);
    assert.deepEqual(ws.getRow(1).values.slice(1), ['id', 'name', 'score']);
    assert.equal(typeof ws.getRow(2).getCell(1).value, 'number');
    assert.equal(typeof ws.getRow(2).getCell(2).value, 'string');
    assert.equal(ws.getRow(3).getCell(2).value, null, 'NULL must be an empty cell');
    assert.equal(ws.views[0].state, 'frozen');
    assert.ok(ws.autoFilter, 'header should be filterable');
  } finally {
    vscodeStub.__recorded.saveDialogPath = null;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to row keys when the driver reports no fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx2-'));
  const file = path.join(dir, 'out.xlsx');
  try {
    vscodeStub.__recorded.saveDialogPath = file;
    await ExportService.exportData('t', { fields: [], rows: [{ a: 1, b: 2 }], costTimeMs: 0 } as any, 'xlsx');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), ['a', 'b']);
  } finally {
    vscodeStub.__recorded.saveDialogPath = null;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('csv quotes and escapes correctly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-'));
  const file = path.join(dir, 'out.csv');
  try {
    vscodeStub.__recorded.saveDialogPath = file;
    await ExportService.exportData('t', {
      fields: [{ name: 'a' }, { name: 'b' }],
      rows: [{ a: 'say "hi"', b: null }],
      costTimeMs: 0,
    } as any, 'csv');
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.split('\n')[0], '"a","b"');
    assert.match(text, /"say ""hi""","";?/);
  } finally {
    vscodeStub.__recorded.saveDialogPath = null;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
