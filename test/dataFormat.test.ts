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

test('DataFormatService formats as TSV table', () => {
  const tsv = DataFormatService.toTsv(mockRows, mockFields);
  assert.match(tsv, /^id\tname\tis_active\tbalance\n/);
  assert.match(tsv, /1\tAlice\ttrue\t150\.5/);
  assert.match(tsv, /2\tBob O'Connor\tfalse\tNULL/);
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

test('DataFormatService generates a Go struct', () => {
  const go = DataFormatService.toGoStruct('user_account', mockFields);
  assert.match(go, /type UserAccount struct \{/);
  assert.match(go, /Id int `json:"id" db:"id"`/);
  assert.match(go, /Name string `json:"name" db:"name"`/);
  // Nullable columns become pointers and gain omitempty.
  assert.match(go, /IsActive \*bool `json:"is_active,omitempty" db:"is_active"`/);
  assert.match(go, /Balance \*float64 `json:"balance,omitempty" db:"balance"`/);
});

test('DataFormatService maps Go types for bigint, json, time and binary', () => {
  const go = DataFormatService.toGoStruct('events', [
    { name: 'id', type: 'bigint', isPrimaryKey: true, nullable: false },
    { name: 'payload', type: 'jsonb', nullable: true },
    { name: 'created_at', type: 'timestamp', nullable: false },
    { name: 'blob_data', type: 'bytea', nullable: true },
  ]);
  assert.match(go, /Id int64 /);
  // Maps and slices are already nilable, so they are not turned into pointers.
  assert.match(go, /Payload map\[string\]interface\{\} /);
  assert.match(go, /CreatedAt time\.Time /);
  assert.match(go, /BlobData \[\]byte /);
});

test('DataFormatService generates a Python dataclass', () => {
  const py = DataFormatService.toPythonDataclass('user_account', mockFields);
  assert.match(py, /from dataclasses import dataclass/);
  assert.match(py, /@dataclass\nclass UserAccount:/);
  assert.match(py, /    id: int/);
  assert.match(py, /    name: str/);
  assert.match(py, /    is_active: Optional\[bool\] = None/);
  assert.match(py, /from typing import Optional/);
});

test('Python dataclass keeps required fields ahead of defaulted ones', () => {
  const py = DataFormatService.toPythonDataclass('t', [
    { name: 'maybe', type: 'text', nullable: true },
    { name: 'always', type: 'integer', nullable: false },
  ]);
  const body = py.slice(py.indexOf('class T:'));
  // Python raises TypeError if a non-default field follows a defaulted one.
  assert.ok(body.indexOf('always: int') < body.indexOf('maybe: Optional[str] = None'));
});

test('Python dataclass imports datetime and Any only when needed', () => {
  const plain = DataFormatService.toPythonDataclass('t', [
    { name: 'id', type: 'integer', nullable: false },
  ]);
  assert.doesNotMatch(plain, /datetime/);
  assert.doesNotMatch(plain, /typing/);

  const rich = DataFormatService.toPythonDataclass('t', [
    { name: 'created_at', type: 'timestamptz', nullable: false },
    { name: 'meta', type: 'json', nullable: false },
  ]);
  assert.match(rich, /from datetime import datetime/);
  assert.match(rich, /from typing import Any/);
  assert.match(rich, /meta: dict\[str, Any\]/);
});
