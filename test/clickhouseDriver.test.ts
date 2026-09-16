import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClickhouseDriver } from '../src/drivers/ClickhouseDriver.js';

test('ClickhouseDriver formats queries and appends FORMAT JSON', async () => {
  const driver = new ClickhouseDriver({
    id: 'ch1',
    name: 'ClickHouse Test',
    type: 'ClickHouse',
    host: 'localhost',
    port: 8123,
    user: 'default',
  } as any, 'secret');

  let executedQuery = '';
  (driver as any).httpQuery = async (query: string) => {
    executedQuery = query;
    return {
      meta: [{ name: 'id', type: 'UInt64' }],
      data: [{ id: 1 }],
      rows: 1,
    };
  };

  const res = await driver.executeQuery('SELECT * FROM my_table');
  assert.equal(executedQuery, 'SELECT * FROM my_table FORMAT JSON;');
  assert.equal(res.rows.length, 1);
  assert.equal(res.fields[0].name, 'id');
});

test('ClickhouseDriver getTableData includes filterSql in both data and count queries', async () => {
  const driver = new ClickhouseDriver({
    id: 'ch1',
    name: 'ClickHouse Test',
    type: 'ClickHouse',
    host: 'localhost',
    port: 8123,
    database: 'analytics',
  } as any);

  const queries: string[] = [];
  (driver as any).httpQuery = async (query: string) => {
    queries.push(query);
    if (query.includes('count()')) {
      return { data: [{ total: '42' }] };
    }
    return {
      meta: [{ name: 'val', type: 'String' }],
      data: [{ val: 'test' }],
      rows: 1,
    };
  };

  const res = await driver.getTableData('events', {
    page: 2,
    pageSize: 10,
    filterSql: "status = 'active'",
    sortField: 'created_at',
    sortOrder: 'DESC',
  });

  assert.equal(res.totalCount, 42);
  const countQuery = queries.find((q) => q.includes('count()'));
  assert.ok(countQuery, 'count query was executed');
  assert.ok(countQuery.includes("WHERE status = 'active'"), 'count query includes filterSql');

  const dataQuery = queries.find((q) => q.includes('LIMIT 10 OFFSET 10'));
  assert.ok(dataQuery, 'data query was executed with offset');
  assert.ok(dataQuery.includes("WHERE status = 'active'"), 'data query includes filterSql');
  assert.ok(dataQuery.includes('ORDER BY `created_at` DESC'), 'data query includes sorting');
});
