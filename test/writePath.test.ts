import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteDriver } from '../src/drivers/SqliteDriver.js';
import { RowWriter, runBound, formatTableRef } from '../src/sql/RowWriter.js';

// Exercises binding against a real engine, not just the generated string.
async function withDb(fn: (d: SqliteDriver, ref: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writepath-'));
  const dbPath = path.join(dir, 'db.sqlite');
  // The driver refuses to open a path that does not exist (a typo'd path is far
  // more likely than an intent to create one), so start from an empty file.
  fs.writeFileSync(dbPath, '');
  const d = new SqliteDriver({ id: 'w', name: 'w', type: 'SQLite', dbPath } as any);
  try {
    await d.connect();
    await d.executeQuery('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, note TEXT)');
    await d.executeQuery("INSERT INTO t (id, name, note) VALUES (1, 'a', 'x'), (2, 'a', 'y'), (3, 'b', 'z')");
    await fn(d, formatTableRef('SQLite', 't'));
  } finally {
    await d.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a value containing SQL is stored as data, not executed', async () => {
  await withDb(async (d, ref) => {
    const evil = "'); DROP TABLE t; --";
    await runBound(d, new RowWriter(d, 'SQLite', ref).update('name', evil, { id: 1 }));
    const res = await d.executeQuery('SELECT name FROM t WHERE id = 1');
    assert.equal(res.rows[0].name, evil, 'the literal text should round-trip');
    const still = await d.executeQuery('SELECT COUNT(*) AS n FROM t');
    assert.equal(still.rows[0].n, 3, 'table must still exist with all rows');
  });
});

test('an update on the primary key touches exactly one row', async () => {
  await withDb(async (d, ref) => {
    const res = await runBound(d, new RowWriter(d, 'SQLite', ref).update('note', 'updated', { id: 2 }));
    assert.equal(res.affectedRows, 1);
    const rows = (await d.executeQuery('SELECT id, note FROM t ORDER BY id')).rows;
    assert.deepEqual(rows.map((r: any) => r.note), ['x', 'updated', 'z']);
  });
});

test('a non-unique key reports every row it hit', async () => {
  // 'name' = 'a' matches two rows; the caller must be able to see that.
  await withDb(async (d, ref) => {
    const res = await runBound(d, new RowWriter(d, 'SQLite', ref).update('note', 'both', { name: 'a' }));
    assert.equal(res.affectedRows, 2, 'affectedRows is what warns the user their key was not unique');
  });
});

test('a stale key affects no rows rather than a wrong one', async () => {
  await withDb(async (d, ref) => {
    const res = await runBound(d, new RowWriter(d, 'SQLite', ref).delete({ id: 999 }));
    assert.equal(res.affectedRows, 0);
    assert.equal((await d.executeQuery('SELECT COUNT(*) AS n FROM t')).rows[0].n, 3);
  });
});

test('numbers bind as numbers, not quoted strings', async () => {
  await withDb(async (d, ref) => {
    await d.executeQuery('CREATE TABLE nums (id INTEGER PRIMARY KEY, v REAL)');
    await runBound(d, new RowWriter(d, 'SQLite', formatTableRef('SQLite', 'nums')).insert({ id: 1, v: 12.5 }));
    const row = (await d.executeQuery('SELECT v, typeof(v) AS ty FROM nums')).rows[0];
    assert.equal(row.v, 12.5);
    assert.equal(row.ty, 'real', 'binding must preserve the numeric type');
  });
});

test('null binds as SQL NULL, not the string "null"', async () => {
  await withDb(async (d, ref) => {
    await runBound(d, new RowWriter(d, 'SQLite', ref).update('note', null, { id: 3 }));
    const row = (await d.executeQuery('SELECT note, typeof(note) AS ty FROM t WHERE id = 3')).rows[0];
    assert.equal(row.note, null);
    assert.equal(row.ty, 'null');
  });
});

test('deleting by composite key removes only that row', async () => {
  await withDb(async (d, ref) => {
    const res = await runBound(d, new RowWriter(d, 'SQLite', ref).delete({ name: 'a', note: 'y' }));
    assert.equal(res.affectedRows, 1);
    assert.deepEqual((await d.executeQuery('SELECT id FROM t ORDER BY id')).rows.map((r: any) => r.id), [1, 3]);
  });
});

test('executeTransaction commits all statements on success', async () => {
  await withDb(async (d, ref) => {
    const statements = [
      new RowWriter(d, 'SQLite', ref).update('name', 'alpha', { id: 1 }),
      new RowWriter(d, 'SQLite', ref).update('name', 'beta', { id: 2 }),
      new RowWriter(d, 'SQLite', ref).update('name', 'gamma', { id: 3 }),
    ];
    await d.executeTransaction(statements);

    const rows = (await d.executeQuery('SELECT id, name FROM t ORDER BY id')).rows;
    assert.deepEqual(rows.map((r: any) => r.name), ['alpha', 'beta', 'gamma']);
  });
});

test('executeTransaction rolls back all statements if one fails', async () => {
  await withDb(async (d, ref) => {
    const statements = [
      new RowWriter(d, 'SQLite', ref).update('name', 'changed_1', { id: 1 }),
      { sql: 'INVALID SQL STATEMENT SYNTAX ERROR;', params: [] },
      new RowWriter(d, 'SQLite', ref).update('name', 'changed_3', { id: 3 }),
    ];

    await assert.rejects(async () => {
      await d.executeTransaction(statements);
    });

    const rows = (await d.executeQuery('SELECT id, name FROM t ORDER BY id')).rows;
    // Row 1 should NOT be 'changed_1' because the transaction was rolled back
    assert.deepEqual(rows.map((r: any) => r.name), ['a', 'a', 'b']);
  });
});
