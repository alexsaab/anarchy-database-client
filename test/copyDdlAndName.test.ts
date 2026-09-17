import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BaseDriver } from '../src/drivers/BaseDriver.js';
import { SqliteDriver } from '../src/drivers/SqliteDriver.js';
import { TableNode } from '../src/tree/TableNode.js';
import { SchemaNode } from '../src/tree/SchemaNode.js';
import { DatabaseNode } from '../src/tree/DatabaseNode.js';
import { ColumnNode } from '../src/tree/ColumnNode.js';
import { ScriptNode } from '../src/tree/ScriptNode.js';
import { ConnectionConfig } from '../src/model/ConnectionConfig.js';
import { ColumnInfo } from '../src/model/QueryTypes.js';

class MockDriver extends BaseDriver {
  public mockColumns: ColumnInfo[] = [];
  public mockForeignKeys: any[] = [];

  constructor(config: ConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async testConnection(): Promise<{ success: boolean; message?: string }> { return { success: true }; }
  async getDatabases(): Promise<string[]> { return ['testdb']; }
  async getTables(): Promise<any[]> { return [{ name: 'users' }]; }
  async getColumns(): Promise<ColumnInfo[]> { return this.mockColumns; }
  override async getForeignKeys(): Promise<any[]> { return this.mockForeignKeys; }
  async executeQuery(): Promise<any> { return { rows: [], fields: [], costTimeMs: 0 }; }
  async getTableData(): Promise<any> { return { rows: [], fields: [], costTimeMs: 0 }; }
}

test('BaseDriver.getTableDdl builds CREATE TABLE statement with columns and constraints for PostgreSQL', async () => {
  const config: ConnectionConfig = {
    id: 'c1',
    name: 'PG Test',
    type: 'PostgreSQL',
    database: 'mydb',
  };
  const driver = new MockDriver(config);
  driver.mockColumns = [
    { name: 'id', type: 'BIGSERIAL', nullable: false, isPrimaryKey: true },
    { name: 'username', type: 'VARCHAR(255)', nullable: false },
    { name: 'bio', type: 'TEXT', nullable: true, defaultValue: "''" },
    { name: 'role_id', type: 'INTEGER', nullable: true },
  ];
  driver.mockForeignKeys = [
    {
      constraintName: 'fk_users_role',
      columnName: 'role_id',
      referencedTable: 'roles',
      referencedColumn: 'id',
    },
  ];

  const ddl = await driver.getTableDdl('users', 'mydb', 'public');
  assert.ok(ddl.includes('CREATE TABLE "public"."users"'));
  assert.ok(ddl.includes('"id" BIGSERIAL NOT NULL'));
  assert.ok(ddl.includes('"username" VARCHAR(255) NOT NULL'));
  assert.ok(ddl.includes('"bio" TEXT DEFAULT \'\''));
  assert.ok(ddl.includes('PRIMARY KEY ("id")'));
  assert.ok(ddl.includes('CONSTRAINT "fk_users_role" FOREIGN KEY ("role_id") REFERENCES "roles" ("id")'));
});

test('BaseDriver.getTableDdl formats properly for MySQL', async () => {
  const config: ConnectionConfig = {
    id: 'c2',
    name: 'MySQL Test',
    type: 'MySQL',
    database: 'mydb',
  };
  const driver = new MockDriver(config);
  driver.mockColumns = [
    { name: 'id', type: 'INT', nullable: false, isPrimaryKey: true },
    { name: 'title', type: 'VARCHAR(100)', nullable: false },
  ];

  const ddl = await driver.getTableDdl('posts', 'mydb');
  assert.ok(ddl.includes('CREATE TABLE `mydb`.`posts`'));
  assert.ok(ddl.includes('`id` INT NOT NULL'));
  assert.ok(ddl.includes('`title` VARCHAR(100) NOT NULL'));
  assert.ok(ddl.includes('PRIMARY KEY (`id`)'));
});

test('SqliteDriver.getTableDdl fetches native CREATE TABLE from sqlite_master', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-ddl-'));
  const dbPath = path.join(dir, 'test.db');
  fs.writeFileSync(dbPath, '');
  const driver = new SqliteDriver({ id: 'sq1', name: 'SQLite', type: 'SQLite', dbPath } as any);

  try {
    await driver.connect();
    await driver.executeQuery('CREATE TABLE employees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dept TEXT DEFAULT "Engineering");');

    const ddl = await driver.getTableDdl('employees');
    assert.ok(ddl.includes('CREATE TABLE employees'));
    assert.ok(ddl.includes('id INTEGER PRIMARY KEY AUTOINCREMENT'));
    assert.ok(ddl.endsWith(';'));

    // Also test getScript with 'table'
    const script = await driver.getScript('employees', 'table');
    assert.equal(script, ddl);
  } finally {
    await driver.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Tree nodes correctly store names for copy operations', () => {
  const config: ConnectionConfig = { id: 'c3', name: 'Test Connection', type: 'PostgreSQL' };
  const mockContext: any = { subscriptions: [] };

  const tableNode = new TableNode({ name: 'orders', schema: 'sales' }, config);
  assert.equal(tableNode.table.name, 'orders');
  assert.equal(tableNode.contextValue, 'tableNode');

  const schemaNode = new SchemaNode('analytics', config, mockContext);
  assert.equal(schemaNode.schemaName, 'analytics');
  assert.equal(schemaNode.contextValue, 'schemaNode');

  const dbNode = new DatabaseNode('production', config, mockContext);
  assert.equal(dbNode.dbName, 'production');
  assert.equal(dbNode.contextValue, 'databaseNode');

  const colNode = new ColumnNode({ name: 'created_at', type: 'TIMESTAMP', isPrimaryKey: false });
  assert.equal(colNode.column.name, 'created_at');
  assert.equal(colNode.contextValue, 'columnNode');

  const scriptNode = new ScriptNode('calculate_tax', 'function', config);
  assert.equal(scriptNode.objectName, 'calculate_tax');
  assert.equal(scriptNode.objectType, 'function');
  assert.equal(scriptNode.contextValue, 'scriptNode');
});
