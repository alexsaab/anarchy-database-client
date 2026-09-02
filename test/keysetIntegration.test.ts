import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteDriver } from '../src/drivers/SqliteDriver.js';
import { cursorFrom, keyColumnsFor } from '../src/sql/Keyset.js';

async function withDb(fn: (d: SqliteDriver) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyset-'));
  const dbPath = path.join(dir, 'db.sqlite');
  fs.writeFileSync(dbPath, '');
  const d = new SqliteDriver({ id: 'k', name: 'k', type: 'SQLite', dbPath } as any);
  try {
    await d.connect();
    await d.executeQuery('CREATE TABLE t (id INTEGER PRIMARY KEY, grp TEXT NOT NULL, note TEXT)');
    for (let i = 1; i <= 100; i++) {
      // Many ties on grp, so the primary-key tiebreak actually matters.
      await d.executeParameterized('INSERT INTO t VALUES (?, ?, ?)', [i, `g${i % 5}`, i % 7 === 0 ? null : `n${i}`]);
    }
    await fn(d);
  } finally {
    await d.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Walks the whole table with Next and returns the ids seen, in order. */
async function walkForward(d: SqliteDriver, pageSize: number, sortField?: string, sortOrder?: any) {
  const columns = await d.getColumns('t');
  const keys = keyColumnsFor(columns, sortField, sortOrder)!;
  assert.ok(keys, 'this fixture should support keyset paging');

  const seen: number[] = [];
  let cursor: any = undefined;
  for (let guard = 0; guard < 50; guard++) {
    const page: any = await d.getTableData('t', {
      page: 1,
      pageSize,
      sortField,
      sortOrder,
      ...(cursor ? { cursor: { values: cursor, direction: 'next' as const } } : {}),
    });
    if (page.rows.length === 0) break;
    seen.push(...page.rows.map((r: any) => r.id));
    cursor = cursorFrom(page.rows[page.rows.length - 1], keys);
    if (page.rows.length < pageSize) break;
  }
  return seen;
}

test('walking forward with a cursor visits every row exactly once', async () => {
  await withDb(async (d) => {
    const seen = await walkForward(d, 7);
    assert.equal(seen.length, 100, 'no rows skipped or repeated');
    assert.equal(new Set(seen).size, 100);
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  });
});

test('a cursor page matches the equivalent OFFSET page', async () => {
  await withDb(async (d) => {
    const first: any = await d.getTableData('t', { page: 1, pageSize: 10 });
    const columns = await d.getColumns('t');
    const keys = keyColumnsFor(columns)!;
    const viaCursor: any = await d.getTableData('t', {
      page: 1,
      pageSize: 10,
      cursor: { values: cursorFrom(first.rows[9], keys), direction: 'next' },
    });
    const viaOffset: any = await d.getTableData('t', { page: 2, pageSize: 10 });
    assert.deepEqual(viaCursor.rows.map((r: any) => r.id), viaOffset.rows.map((r: any) => r.id));
  });
});

test('ties on the sort column are broken by the primary key, with no repeats', async () => {
  await withDb(async (d) => {
    // grp has only 5 distinct values across 100 rows.
    const seen = await walkForward(d, 6, 'grp', 'ASC');
    assert.equal(seen.length, 100, `expected every row once, saw ${seen.length}`);
    assert.equal(new Set(seen).size, 100, 'a row was returned twice');
  });
});

test('descending order walks correctly too', async () => {
  await withDb(async (d) => {
    const seen = await walkForward(d, 9, 'id', 'DESC');
    assert.equal(seen.length, 100);
    assert.deepEqual(seen, [...seen].sort((a, b) => b - a));
  });
});

test('going back with a cursor returns the previous page in reading order', async () => {
  await withDb(async (d) => {
    const columns = await d.getColumns('t');
    const keys = keyColumnsFor(columns)!;
    const page3: any = await d.getTableData('t', { page: 3, pageSize: 10 });
    const back: any = await d.getTableData('t', {
      page: 3,
      pageSize: 10,
      cursor: { values: cursorFrom(page3.rows[0], keys), direction: 'prev' },
    });
    const page2: any = await d.getTableData('t', { page: 2, pageSize: 10 });
    assert.deepEqual(back.rows.map((r: any) => r.id), page2.rows.map((r: any) => r.id));
  });
});

test('keyset paging is skipped for a nullable sort column', async () => {
  await withDb(async (d) => {
    const columns = await d.getColumns('t');
    assert.equal(keyColumnsFor(columns, 'note', 'ASC'), null, 'note is nullable');
    // The driver must still return a correct page, via OFFSET.
    const page: any = await d.getTableData('t', {
      page: 2,
      pageSize: 10,
      sortField: 'note',
      sortOrder: 'ASC',
      cursor: { values: { note: 'n1' }, direction: 'next' },
    });
    assert.equal(page.rows.length, 10);
    assert.equal(page.totalCount, 100);
  });
});

test('search and keyset paging combine', async () => {
  await withDb(async (d) => {
    const columns = await d.getColumns('t');
    const keys = keyColumnsFor(columns)!;
    const first: any = await d.getTableData('t', { page: 1, pageSize: 5, searchTerm: 'g1' });
    assert.equal(first.totalCount, 20, 'g1 appears 20 times');
    const next: any = await d.getTableData('t', {
      page: 1,
      pageSize: 5,
      searchTerm: 'g1',
      cursor: { values: cursorFrom(first.rows[4], keys), direction: 'next' },
    });
    assert.equal(next.totalCount, 20, 'the count still reflects the search');
    const overlap = next.rows.filter((r: any) => first.rows.some((f: any) => f.id === r.id));
    assert.equal(overlap.length, 0, 'pages must not overlap');
  });
});

test('fast jump to last page returns exact tail rows in natural order', async () => {
  await withDb(async (d) => {
    // 100 rows, pageSize 7 -> 15 pages. Page 15 has 2 rows (id 99, 100).
    const fastLast: any = await d.getTableData('t', {
      page: 15,
      pageSize: 7,
      isLastPage: true,
      totalCount: 100,
    });
    const regularLast: any = await d.getTableData('t', {
      page: 15,
      pageSize: 7,
    });
    assert.equal(fastLast.rows.length, 2);
    assert.deepEqual(
      fastLast.rows.map((r: any) => r.id),
      [99, 100]
    );
    assert.deepEqual(
      fastLast.rows.map((r: any) => r.id),
      regularLast.rows.map((r: any) => r.id)
    );
  });
});

test('fast jump to last page works with custom sorting', async () => {
  await withDb(async (d) => {
    const fastLast: any = await d.getTableData('t', {
      page: 10,
      pageSize: 10,
      sortField: 'grp',
      sortOrder: 'ASC',
      isLastPage: true,
      totalCount: 100,
    });
    const regularLast: any = await d.getTableData('t', {
      page: 10,
      pageSize: 10,
      sortField: 'grp',
      sortOrder: 'ASC',
    });
    assert.equal(fastLast.rows.length, 10);
    assert.deepEqual(
      fastLast.rows.map((r: any) => r.id),
      regularLast.rows.map((r: any) => r.id)
    );
  });
});
