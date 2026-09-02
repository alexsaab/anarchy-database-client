import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuckdbDriver } from '../src/drivers/DuckdbDriver.js';
import { ConnectionConfig } from '../src/model/ConnectionConfig.js';

test('DuckdbDriver in-memory operations', async (t) => {
  const config: ConnectionConfig = {
    id: 'duckdb-test-1',
    name: 'DuckDB Test',
    type: 'DuckDB',
    dbPath: ':memory:',
  };

  const driver = new DuckdbDriver(config);

  await t.test('connects and tests connection successfully', async () => {
    const res = await driver.testConnection();
    assert.equal(res.success, true);
  });

  await t.test('creates table, inserts rows, and introspects schema', async () => {
    await driver.executeQuery(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name VARCHAR,
        price DOUBLE,
        in_stock BOOLEAN
      );
    `);

    await driver.executeParameterized(
      'INSERT INTO products VALUES (?, ?, ?, ?), (?, ?, ?, ?);',
      [1, 'Apples', 2.5, true, 2, 'Bananas', 1.8, false]
    );

    const tables = await driver.getTables();
    assert.ok(tables.some(tbl => tbl.name === 'products'), 'products table should be found');

    const columns = await driver.getColumns('products');
    assert.equal(columns.length, 4);
    const idCol = columns.find(c => c.name === 'id');
    assert.ok(idCol);
    assert.equal(idCol?.isPrimaryKey, true);

    const nameCol = columns.find(c => c.name === 'name');
    assert.ok(nameCol);
    assert.equal(nameCol?.isPrimaryKey, false);
  });

  await t.test('getTableData pages results correctly', async () => {
    const data = await driver.getTableData('products', { page: 1, pageSize: 1 });
    assert.equal(data.rows.length, 1);
    assert.equal(data.totalCount, 2);
    assert.equal(data.rows[0].name, 'Apples');

    const page2 = await driver.getTableData('products', { page: 2, pageSize: 1 });
    assert.equal(page2.rows.length, 1);
    assert.equal(page2.rows[0].name, 'Bananas');
  });

  await t.test('supports analytical SQL features (e.g. inline values, aggregation)', async () => {
    const res = await driver.executeQuery(`
      SELECT
        COUNT(*) AS total_items,
        AVG(price) AS avg_price
      FROM products;
    `);

    assert.equal(res.rows.length, 1);
    assert.equal(Number(res.rows[0].total_items), 2);
    assert.ok(res.rows[0].avg_price > 2.0);
  });

  await driver.disconnect();
});
