import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteDriver } from '../src/drivers/SqliteDriver.js';
import { ImportService } from '../src/import/ImportService.js';
import { ExportService } from '../src/export/ExportService.js';
import { RowWriter, formatTableRef, runBound } from '../src/sql/RowWriter.js';
const vscodeStub = require('vscode');

async function withDb(fn: (d: SqliteDriver, dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-'));
  const dbPath = path.join(dir, 'db.sqlite');
  fs.writeFileSync(dbPath, '');
  const d = new SqliteDriver({ id: 'r', name: 'r', type: 'SQLite', dbPath } as any);
  try {
    await d.connect();
    await fn(d, dir);
  } finally {
    await d.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('export to Excel then import back reproduces the rows', async () => {
  await withDb(async (d, dir) => {
    await d.executeQuery('CREATE TABLE src (id INTEGER PRIMARY KEY, name TEXT, score REAL, note TEXT)');
    await d.executeQuery(`INSERT INTO src VALUES (1,'Ada',7.5,'first'),(2,'Bob',NULL,'has "quotes"'),(3,'Cy, Jr.',3.25,NULL)`);
    await d.executeQuery('CREATE TABLE dst (id INTEGER PRIMARY KEY, name TEXT, score REAL, note TEXT)');

    const file = path.join(dir, 'out.xlsx');
    vscodeStub.__recorded.saveDialogPath = file;
    const page = await d.getTableData('src', { page: 1, pageSize: 100 });
    await ExportService.exportData('src', page, 'xlsx');
    vscodeStub.__recorded.saveDialogPath = null;

    const sheet = await ImportService.parseXlsx(file);
    assert.deepEqual(sheet.headers, ['id', 'name', 'score', 'note']);
    assert.equal(sheet.rows.length, 3);

    const columns = await d.getColumns('dst');
    const ref = formatTableRef('SQLite', 'dst');
    for (const row of sheet.rows) {
      const data: Record<string, any> = {};
      sheet.headers.forEach((h, i) => {
        const col = columns.find((c) => c.name === h);
        data[h] = ImportService.coerce(row[i], col);
      });
      await runBound(d, new RowWriter(d, 'SQLite', ref).insert(data));
    }

    const before = (await d.executeQuery('SELECT id,name,score,note FROM src ORDER BY id')).rows;
    const after = (await d.executeQuery('SELECT id,name,score,note FROM dst ORDER BY id')).rows;
    assert.deepEqual(after, before, 'round-tripped rows must match the originals');
  });
});

test('csv round trip preserves commas, quotes and NULLs', async () => {
  await withDb(async (d, dir) => {
    await d.executeQuery('CREATE TABLE src (id INTEGER PRIMARY KEY, txt TEXT)');
    await d.executeQuery(`INSERT INTO src VALUES (1,'a,b'),(2,'say "hi"'),(3,NULL)`);
    await d.executeQuery('CREATE TABLE dst (id INTEGER PRIMARY KEY, txt TEXT)');

    const file = path.join(dir, 'out.csv');
    vscodeStub.__recorded.saveDialogPath = file;
    await ExportService.exportData('src', await d.getTableData('src', { page: 1, pageSize: 100 }), 'csv');
    vscodeStub.__recorded.saveDialogPath = null;

    const sheet = ImportService.parseCsv(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(sheet.headers, ['id', 'txt']);
    assert.equal(sheet.rows[0][1], 'a,b');
    assert.equal(sheet.rows[1][1], 'say "hi"');

    const columns = await d.getColumns('dst');
    const ref = formatTableRef('SQLite', 'dst');
    for (const row of sheet.rows) {
      const data: Record<string, any> = {};
      sheet.headers.forEach((h, i) => {
        data[h] = ImportService.coerce(row[i], columns.find((c) => c.name === h));
      });
      await runBound(d, new RowWriter(d, 'SQLite', ref).insert(data));
    }

    const after = (await d.executeQuery('SELECT id,txt FROM dst ORDER BY id')).rows;
    assert.deepEqual(after, [{ id: 1, txt: 'a,b' }, { id: 2, txt: 'say "hi"' }, { id: 3, txt: null }]);
  });
});
