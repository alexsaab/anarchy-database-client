import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDriver } from '../src/drivers/PostgresDriver.js';
import { MysqlDriver } from '../src/drivers/MysqlDriver.js';

/**
 * Runs against throwaway servers when they are available:
 *   docker run -d --rm --name adbc-test-pg    -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=testdb -p 55432:5432 postgres:16-alpine
 *   docker run -d --rm --name adbc-test-mysql -e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=testdb -p 53306:3306 mysql:8
 * Skipped automatically when they are not running, so CI without Docker stays green.
 */
const PG = { id: 'pgt', name: 'pgt', type: 'PostgreSQL', host: '127.0.0.1', port: 55432, user: 'postgres', database: 'testdb' } as any;
const MY = { id: 'myt', name: 'myt', type: 'MySQL', host: '127.0.0.1', port: 53306, user: 'root', database: 'testdb' } as any;

async function reachable(make: () => any): Promise<boolean> {
  const d = make();
  try {
    const r = await d.testConnection();
    await d.disconnect();
    return !!r.success;
  } catch {
    return false;
  }
}

// Probed lazily inside each test: top-level await is unavailable in CJS output.
let pgUp: boolean | null = null;
let myUp: boolean | null = null;

async function requirePg(t: any): Promise<boolean> {
  if (pgUp === null) pgUp = await reachable(() => new PostgresDriver(PG, 'testpw'));
  if (!pgUp) t.skip('no PostgreSQL on 127.0.0.1:55432');
  return pgUp;
}
async function requireMy(t: any): Promise<boolean> {
  if (myUp === null) myUp = await reachable(() => new MysqlDriver(MY, 'testpw'));
  if (!myUp) t.skip('no MySQL on 127.0.0.1:53306');
  return myUp;
}

describe('PostgreSQL (live)', () => {
  const driver = () => new PostgresDriver(PG, 'testpw');

  test('concurrent queries do not serialise behind one connection', async (t: any) => {
    if (!(await requirePg(t))) return;
    const d = driver();
    await d.connect();
    try {
      const started = Date.now();
      // Four half-second sleeps: on one connection this takes ~2s, pooled ~0.5s.
      await Promise.all([1, 2, 3, 4].map(() => d.executeQuery('SELECT pg_sleep(0.5)')));
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 1500, `expected concurrency, took ${elapsed}ms`);
    } finally {
      await d.disconnect();
    }
  });

  test('a long query can be cancelled', async (t: any) => {
    if (!(await requirePg(t))) return;
    const d = driver();
    await d.connect();
    try {
      const id = d.beginQueryId();
      // Attach the handler immediately: the query rejects as soon as the cancel
      // lands, which would otherwise surface as an unhandled rejection.
      const settled = d.executeQuery('SELECT pg_sleep(30)', id).then(
        () => ({ ok: true, error: null as any }),
        (e) => ({ ok: false, error: e })
      );
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(await d.cancelQuery(id), true, 'cancel should be accepted');

      const started = Date.now();
      const outcome = await settled;
      assert.ok(Date.now() - started < 5000, 'the query should stop promptly, not run its full 30s');
      assert.equal(outcome.ok, false, 'a cancelled statement must fail rather than return rows');
      assert.match(String(outcome.error.message), /cancel/i);
    } finally {
      await d.disconnect();
    }
  });

  test('the pool keeps working after a cancelled query', async (t: any) => {
    if (!(await requirePg(t))) return;
    const d = driver();
    await d.connect();
    try {
      const id = d.beginQueryId();
      const running = d.executeQuery('SELECT pg_sleep(30)', id).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
      await d.cancelQuery(id);
      await running;
      const res = await d.executeQuery('SELECT 42 AS answer');
      assert.equal(Number(res.rows[0].answer), 42);
    } finally {
      await d.disconnect();
    }
  });

  test('parameterized writes and reads round-trip', async (t: any) => {
    if (!(await requirePg(t))) return;
    const d = driver();
    await d.connect();
    try {
      await d.executeQuery('DROP TABLE IF EXISTS t_param');
      await d.executeQuery('CREATE TABLE t_param (id int primary key, txt text, n numeric)');
      await d.executeParameterized('INSERT INTO t_param (id, txt, n) VALUES ($1, $2, $3)', [1, "it's; DROP", 12.5]);
      const res = await d.executeQuery('SELECT txt, n FROM t_param WHERE id = 1');
      assert.equal(res.rows[0].txt, "it's; DROP");
      assert.equal(Number(res.rows[0].n), 12.5);
      await d.executeQuery('DROP TABLE t_param');
    } finally {
      await d.disconnect();
    }
  });

  test('server-side search finds rows beyond the first page', async (t: any) => {
    if (!(await requirePg(t))) return;
    const d = driver();
    await d.connect();
    try {
      await d.executeQuery('DROP TABLE IF EXISTS t_search');
      await d.executeQuery('CREATE TABLE t_search (id int primary key, name text)');
      for (let i = 1; i <= 120; i++) {
        await d.executeParameterized('INSERT INTO t_search VALUES ($1, $2)', [i, i === 118 ? 'NEEDLE' : `user${i}`]);
      }
      const res = await d.getTableData('t_search', { page: 1, pageSize: 50, searchTerm: 'needle' }, 'public');
      assert.equal(res.totalCount, 1);
      assert.equal(res.rows[0].id, 118);
      await d.executeQuery('DROP TABLE t_search');
    } finally {
      await d.disconnect();
    }
  });
});

describe('MySQL (live)', () => {
  const driver = () => new MysqlDriver(MY, 'testpw');

  test('concurrent queries do not serialise behind one connection', async (t: any) => {
    if (!(await requireMy(t))) return;
    const d = driver();
    await d.connect();
    try {
      const started = Date.now();
      await Promise.all([1, 2, 3, 4].map(() => d.executeQuery('SELECT SLEEP(0.5)')));
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 1500, `expected concurrency, took ${elapsed}ms`);
    } finally {
      await d.disconnect();
    }
  });

  test('a long query can be cancelled', async (t: any) => {
    if (!(await requireMy(t))) return;
    const d = driver();
    await d.connect();
    try {
      const id = d.beginQueryId();
      const settled = d.executeQuery('SELECT SLEEP(30)', id).then(
        () => 'returned',
        () => 'rejected'
      );
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(await d.cancelQuery(id), true, 'KILL QUERY should be accepted');

      // MySQL's SLEEP() returns 1 when interrupted rather than raising, so the
      // proof of cancellation is that it stops long before its 30 seconds.
      const started = Date.now();
      const outcome = await settled;
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 5000, `the query kept running for ${elapsed}ms after KILL QUERY`);
      assert.ok(outcome === 'returned' || outcome === 'rejected');

      const res = await d.executeQuery('SELECT 42 AS answer');
      assert.equal(Number(res.rows[0].answer), 42, 'pool still usable');
    } finally {
      await d.disconnect();
    }
  });

  test('parameterized writes keep types and escape values', async (t: any) => {
    if (!(await requireMy(t))) return;
    const d = driver();
    await d.connect();
    try {
      await d.executeQuery('DROP TABLE IF EXISTS t_param');
      await d.executeQuery('CREATE TABLE t_param (id int primary key, txt text, n decimal(10,2))');
      await d.executeParameterized('INSERT INTO t_param (id, txt, n) VALUES (?, ?, ?)', [1, "it's; DROP", 12.5]);
      const res = await d.executeQuery('SELECT txt, n FROM t_param WHERE id = 1');
      assert.equal(res.rows[0].txt, "it's; DROP");
      assert.equal(Number(res.rows[0].n), 12.5);
      await d.executeQuery('DROP TABLE t_param');
    } finally {
      await d.disconnect();
    }
  });

  test('server-side search finds rows beyond the first page', async (t: any) => {
    if (!(await requireMy(t))) return;
    const d = driver();
    await d.connect();
    try {
      await d.executeQuery('DROP TABLE IF EXISTS t_search');
      await d.executeQuery('CREATE TABLE t_search (id int primary key, name varchar(64))');
      for (let i = 1; i <= 120; i++) {
        await d.executeParameterized('INSERT INTO t_search VALUES (?, ?)', [i, i === 118 ? 'NEEDLE' : `user${i}`]);
      }
      const res = await d.getTableData('t_search', { page: 1, pageSize: 50, searchTerm: 'needle' });
      assert.equal(res.totalCount, 1);
      assert.equal(res.rows[0].id, 118);
      await d.executeQuery('DROP TABLE t_search');
    } finally {
      await d.disconnect();
    }
  });
});

const MG = { id: 'mgt', name: 'mgt', type: 'MongoDB', host: '127.0.0.1', port: 57017, database: 'testdb' } as any;
let mgUp: boolean | null = null;
async function requireMongo(t: any): Promise<boolean> {
  if (mgUp === null) {
    const { MongoDriver } = await import('../src/drivers/MongoDriver.js');
    mgUp = await reachable(() => new MongoDriver(MG));
  }
  if (!mgUp) t.skip('no MongoDB on 127.0.0.1:57017');
  return mgUp;
}

describe('MongoDB (live)', () => {
  test('documents can be inserted, updated and deleted by _id', async (t: any) => {
    if (!(await requireMongo(t))) return;
    const { MongoDriver } = await import('../src/drivers/MongoDriver.js');
    const d = new MongoDriver(MG);
    await d.connect();
    const coll = 'adbc_scratch_rows';
    try {
      assert.equal(d.supportsSqlWrites, false, 'SQL must never be generated for Mongo');
      assert.equal(d.supportsRowWrites, true, 'but native edits are supported');

      await d.insertRowNative(coll, { name: 'Ada', score: 10 });
      await d.insertRowNative(coll, { name: 'Bob', score: 20 });
      let page = await d.getTableData(coll, { page: 1, pageSize: 10 });
      assert.equal(page.totalCount, 2);

      // The grid only ever sees the string form of an ObjectId.
      const bob = page.rows.find((r: any) => r.name === 'Bob');
      const affected = await d.updateRowNative(coll, { _id: String(bob._id) }, 'score', 99);
      assert.equal(affected, 1);

      page = await d.getTableData(coll, { page: 1, pageSize: 10 });
      assert.equal(page.rows.find((r: any) => r.name === 'Bob').score, 99);

      await assert.rejects(
        () => d.updateRowNative(coll, { _id: String(bob._id) }, '_id', 'nope'),
        /immutable/i,
        '_id must not be editable'
      );

      assert.equal(await d.deleteRowNative(coll, { _id: String(bob._id) }), 1);
      page = await d.getTableData(coll, { page: 1, pageSize: 10 });
      assert.equal(page.totalCount, 1);
    } finally {
      try {
        await (d as any).client?.db('testdb').collection(coll).drop();
      } catch (e) {}
      await d.disconnect();
    }
  });
});

const MS = { id: 'mst', name: 'mst', type: 'SQLServer', host: '127.0.0.1', port: 51433, user: 'sa', database: 'testdb' } as any;
const MARIA = { id: 'mart', name: 'mart', type: 'MySQL', host: '127.0.0.1', port: 53307, user: 'root', database: 'testdb' } as any;
let msUp: boolean | null = null;
let mariaUp: boolean | null = null;

async function requireMssql(t: any): Promise<boolean> {
  if (msUp === null) {
    const { MssqlDriver } = await import('../src/drivers/MssqlDriver.js');
    msUp = await reachable(() => new MssqlDriver(MS, 'Str0ng!Passw0rd'));
  }
  if (!msUp) t.skip('no SQL Server on 127.0.0.1:51433');
  return msUp;
}
async function requireMaria(t: any): Promise<boolean> {
  if (mariaUp === null) mariaUp = await reachable(() => new MysqlDriver(MARIA, 'testpw'));
  if (!mariaUp) t.skip('no MariaDB on 127.0.0.1:53307');
  return mariaUp;
}

describe('SQL Server (live)', () => {
  test('reads schema, pages, searches and writes', async (t: any) => {
    if (!(await requireMssql(t))) return;
    const { MssqlDriver } = await import('../src/drivers/MssqlDriver.js');
    const { RowWriter, formatTableRef, runBound } = await import('../src/sql/RowWriter.js');
    const d = new MssqlDriver(MS, 'Str0ng!Passw0rd');
    await d.connect();
    try {
      await d.executeQuery("IF OBJECT_ID('dbo.t_live') IS NOT NULL DROP TABLE dbo.t_live");
      await d.executeQuery('CREATE TABLE dbo.t_live (id int PRIMARY KEY, name nvarchar(64), n decimal(10,2))');
      for (let i = 1; i <= 120; i++) {
        await d.executeParameterized('INSERT INTO dbo.t_live (id, name, n) VALUES (@p1, @p2, @p3)', [
          i,
          i === 118 ? 'NEEDLE' : `user${i}`,
          i / 2,
        ]);
      }

      const tables = await d.getTables(undefined, 'dbo');
      assert.ok(tables.some((x) => x.name === 't_live'), 'table listing');

      const cols = await d.getColumns('t_live', undefined, 'dbo');
      assert.deepEqual(cols.map((c) => c.name), ['id', 'name', 'n']);
      assert.equal(cols.find((c) => c.name === 'id')!.isPrimaryKey, true, 'primary key detected');

      const page = await d.getTableData('t_live', { page: 2, pageSize: 50 }, 'dbo');
      assert.equal(page.totalCount, 120);
      assert.equal(page.rows.length, 50);

      const sorted = await d.getTableData('t_live', { page: 1, pageSize: 5, sortField: 'id', sortOrder: 'DESC' }, 'dbo');
      assert.deepEqual(sorted.rows.map((r: any) => r.id), [120, 119, 118, 117, 116]);

      const found = await d.getTableData('t_live', { page: 1, pageSize: 10, searchTerm: 'needle' }, 'dbo');
      assert.equal(found.totalCount, 1);
      assert.equal(found.rows[0].id, 118);

      // Bound writes through the shared RowWriter, using @p placeholders.
      const ref = formatTableRef('SQLServer', 't_live', 'dbo');
      const evil = "'); DROP TABLE dbo.t_live; --";
      const upd = await runBound(d, new RowWriter(d, 'SQLServer', ref).update('name', evil, { id: 1 }));
      assert.equal(upd.affectedRows, 1);
      const back = await d.executeQuery('SELECT name FROM dbo.t_live WHERE id = 1');
      assert.equal(back.rows[0].name, evil, 'the value must be stored, not executed');
      assert.equal((await d.executeQuery('SELECT COUNT(*) AS n FROM dbo.t_live')).rows[0].n, 120, 'table survived');

      const del = await runBound(d, new RowWriter(d, 'SQLServer', ref).delete({ id: 2 }));
      assert.equal(del.affectedRows, 1);

      await d.executeQuery('DROP TABLE dbo.t_live');
    } finally {
      await d.disconnect();
    }
  });

  test('a long query can be cancelled', async (t: any) => {
    if (!(await requireMssql(t))) return;
    const { MssqlDriver } = await import('../src/drivers/MssqlDriver.js');
    const d = new MssqlDriver(MS, 'Str0ng!Passw0rd');
    await d.connect();
    try {
      const id = d.beginQueryId();
      const settled = d.executeQuery("WAITFOR DELAY '00:00:30'", id).then(() => 'returned', () => 'rejected');
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(await d.cancelQuery(id), true);
      const started = Date.now();
      await settled;
      assert.ok(Date.now() - started < 5000, 'the statement should stop promptly');
      assert.equal(Number((await d.executeQuery('SELECT 42 AS answer')).rows[0].answer), 42, 'pool still usable');
    } finally {
      await d.disconnect();
    }
  });
});

describe('MariaDB via the MySQL driver (live)', () => {
  test('the MySQL driver works unchanged against MariaDB', async (t: any) => {
    if (!(await requireMaria(t))) return;
    const d = new MysqlDriver(MARIA, 'testpw');
    await d.connect();
    try {
      const version = (await d.executeQuery('SELECT VERSION() AS v')).rows[0].v;
      assert.match(String(version), /mariadb/i, `expected MariaDB, got ${version}`);

      await d.executeQuery('DROP TABLE IF EXISTS t_maria');
      await d.executeQuery('CREATE TABLE t_maria (id int primary key, name varchar(64))');
      for (let i = 1; i <= 60; i++) {
        await d.executeParameterized('INSERT INTO t_maria VALUES (?, ?)', [i, i === 58 ? 'NEEDLE' : `user${i}`]);
      }

      const cols = await d.getColumns('t_maria', 'testdb');
      assert.equal(cols.find((c) => c.name === 'id')!.isPrimaryKey, true);

      const found = await d.getTableData('t_maria', { page: 1, pageSize: 10, searchTerm: 'needle' });
      assert.equal(found.totalCount, 1);
      assert.equal(found.rows[0].id, 58);

      await d.executeQuery('DROP TABLE t_maria');
    } finally {
      await d.disconnect();
    }
  });
});

describe('keyset paging (live PostgreSQL)', () => {
  test('cursor paging cost stays flat as pages get deeper', async (t: any) => {
    if (!(await requirePg(t))) return;
    const { cursorFrom, keyColumnsFor } = await import('../src/sql/Keyset.js');
    const d = new PostgresDriver(PG, 'testpw');
    await d.connect();
    try {
      await d.executeQuery('DROP TABLE IF EXISTS t_deep');
      await d.executeQuery('CREATE TABLE t_deep (id int primary key, payload text not null)');
      await d.executeQuery(
        "INSERT INTO t_deep SELECT g, repeat('x', 200) FROM generate_series(1, 400000) g"
      );

      const columns = await d.getColumns('t_deep', undefined, 'public');
      const keys = keyColumnsFor(columns)!;
      assert.ok(keys, 'the primary key should enable keyset paging');

      const PAGE = 1000;
      const DEEP = 350;                       // OFFSET 349000

      const offsetStart = Date.now();
      const viaOffset: any = await d.getTableData('t_deep', { page: DEEP, pageSize: PAGE }, 'public');
      const offsetMs = Date.now() - offsetStart;

      // Cursor positioned at the last row before that page.
      const boundary: any = await d.getTableData(
        't_deep',
        { page: 1, pageSize: 1, filterSql: `id = ${(DEEP - 1) * PAGE}` },
        'public'
      );
      const cursorStart = Date.now();
      const viaCursor: any = await d.getTableData(
        't_deep',
        { page: 1, pageSize: PAGE, cursor: { values: cursorFrom(boundary.rows[0], keys), direction: 'next' } },
        'public'
      );
      const cursorMs = Date.now() - cursorStart;

      assert.deepEqual(
        viaCursor.rows.map((r: any) => r.id),
        viaOffset.rows.map((r: any) => r.id),
        'both routes must return the same page'
      );
      // The meaningful property is not a fixed speedup but that cursor cost is
      // flat with depth while OFFSET grows: a shallow cursor page and a deep one
      // should cost about the same.
      const shallowBoundary: any = await d.getTableData(
        't_deep',
        { page: 1, pageSize: 1, filterSql: 'id = 1000' },
        'public'
      );
      const shallowStart = Date.now();
      await d.getTableData(
        't_deep',
        { page: 1, pageSize: PAGE, cursor: { values: cursorFrom(shallowBoundary.rows[0], keys), direction: 'next' } },
        'public'
      );
      const shallowCursorMs = Date.now() - shallowStart;

      assert.ok(
        cursorMs < shallowCursorMs * 4 + 50,
        `cursor cost should not grow with depth: shallow ${shallowCursorMs}ms vs deep ${cursorMs}ms`
      );
      console.log(
        `      deep page ${DEEP}: OFFSET ${offsetMs}ms, cursor ${cursorMs}ms (shallow cursor ${shallowCursorMs}ms)`
      );

      await d.executeQuery('DROP TABLE t_deep');
    } finally {
      await d.disconnect();
    }
  });
});
