import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteDriver } from '../src/drivers/SqliteDriver.js';

async function withDb(fn: (d: SqliteDriver) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
  const dbPath = path.join(dir, 'db.sqlite');
  fs.writeFileSync(dbPath, '');
  const d = new SqliteDriver({ id: 's', name: 's', type: 'SQLite', dbPath } as any);
  try {
    await d.connect();
    await d.executeQuery('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, pct TEXT)');
    for (let i = 1; i <= 120; i++) {
      await d.executeQuery(`INSERT INTO t (id, name, pct) VALUES (${i}, 'user${i}', '${i}%')`);
    }
    await d.executeQuery("UPDATE t SET name = 'NEEDLE' WHERE id = 118");
    await fn(d);
  } finally {
    await d.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('search finds a row that is not on the current page', async () => {
  await withDb(async (d) => {
    // Row 118 is on page 3 at 50 per page; the old client-side filter missed it.
    const res = await d.getTableData('t', { page: 1, pageSize: 50, searchTerm: 'NEEDLE' });
    assert.equal(res.totalCount, 1);
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].id, 118);
  });
});

test('totalCount reflects the search, so paging stays correct', async () => {
  await withDb(async (d) => {
    // Derive the expectation from the data rather than counting by hand.
    const expected = (await d.executeQuery("SELECT COUNT(*) AS n FROM t WHERE name LIKE '%user1%'")).rows[0].n;
    const res = await d.getTableData('t', { page: 1, pageSize: 5, searchTerm: 'user1' });
    assert.equal(res.totalCount, expected);
    assert.ok(expected > 5, 'the fixture must span more than one page');
    assert.equal(res.rows.length, 5, 'a page is still a page');
    const page2 = await d.getTableData('t', { page: 2, pageSize: 5, searchTerm: 'user1' });
    assert.notEqual(page2.rows[0].id, res.rows[0].id);
  });
});

test('search is case-insensitive', async () => {
  await withDb(async (d) => {
    assert.equal((await d.getTableData('t', { page: 1, pageSize: 10, searchTerm: 'needle' })).totalCount, 1);
    assert.equal((await d.getTableData('t', { page: 1, pageSize: 10, searchTerm: 'NeEdLe' })).totalCount, 1);
  });
});

test('search matches numeric columns by casting them to text', async () => {
  await withDb(async (d) => {
    const res = await d.getTableData('t', { page: 1, pageSize: 10, searchTerm: '118' });
    assert.ok(res.rows.some((r: any) => r.id === 118));
  });
});

test('a percent sign is searched literally, not as a wildcard', async () => {
  await withDb(async (d) => {
    // '7%' must match the pct value '7%' only, not every row.
    const res = await d.getTableData('t', { page: 1, pageSize: 200, searchTerm: '7%' });
    assert.ok(res.totalCount < 120, `a literal % matched everything: ${res.totalCount}`);
    assert.ok(res.rows.some((r: any) => r.pct === '7%'));
  });
});

test('search combines with sorting', async () => {
  await withDb(async (d) => {
    const res = await d.getTableData('t', { page: 1, pageSize: 5, searchTerm: 'user1', sortField: 'id', sortOrder: 'DESC' });
    const ids = res.rows.map((r: any) => r.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  });
});

test('an injection attempt in the term is treated as text', async () => {
  await withDb(async (d) => {
    const res = await d.getTableData('t', { page: 1, pageSize: 10, searchTerm: "'; DROP TABLE t; --" });
    assert.equal(res.totalCount, 0);
    assert.equal((await d.executeQuery('SELECT COUNT(*) AS n FROM t')).rows[0].n, 120, 'table must survive');
  });
});
