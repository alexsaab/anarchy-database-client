import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataFormatService } from '../src/export/DataFormatService.js';
import { ColumnInfo } from '../src/model/QueryTypes.js';

const mockFields: ColumnInfo[] = [
  { name: 'id', type: 'integer', isPrimaryKey: true, nullable: false },
  { name: 'name', type: 'varchar(100)', nullable: false },
  { name: 'is_active', type: 'boolean', nullable: true },
  { name: 'balance', type: 'decimal(10,2)', nullable: true },
];

const mockRows = [
  { id: 1, name: 'Alice', is_active: true, balance: 150.50 },
  { id: 2, name: 'Bob O\'Connor', is_active: false, balance: null },
];

test('DataFormatService formats as Markdown table', () => {
  const md = DataFormatService.toMarkdown(mockRows, mockFields);
  assert.match(md, /\| id \| name \| is_active \| balance \|/);
  assert.match(md, /\| 1 \| Alice \| true \| 150.5 \|/);
  assert.match(md, /Bob O'Connor/);
});

test('DataFormatService formats as SQL INSERT statements', () => {
  const sql = DataFormatService.toSqlInsert('users', mockRows, mockFields);
  assert.match(sql, /INSERT INTO `users` \(`id`, `name`, `is_active`, `balance`\) VALUES \(1, 'Alice', TRUE, 150.5\);/);
  assert.match(sql, /'Bob O''Connor'/);
  assert.match(sql, /NULL\);/);
});

test('DataFormatService formats as JSON', () => {
  const jsonStr = DataFormatService.toJson(mockRows);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Alice');
});

test('DataFormatService generates TypeScript interface', () => {
  const ts = DataFormatService.toTypeScript('user_account', mockFields);
  assert.match(ts, /export interface UserAccount \{/);
  assert.match(ts, /id: number;/);
  assert.match(ts, /name: string;/);
  assert.match(ts, /is_active\?: boolean;/);
  assert.match(ts, /balance\?: number;/);
});
