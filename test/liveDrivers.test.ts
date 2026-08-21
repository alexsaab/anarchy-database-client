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
