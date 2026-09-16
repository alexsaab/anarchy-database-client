import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RowWriter, quoteId, formatTableRef, inlineParams, buildLimitOneQuery } from '../src/sql/RowWriter.js';

const pg = { placeholder: (i: number) => `$${i}` };
const qm = { placeholder: () => '?' };

test('identifiers are quoted per dialect and internal quotes doubled', () => {
  assert.equal(quoteId('MySQL', 'tbl'), '`tbl`');
  assert.equal(quoteId('PostgreSQL', 'tbl'), '"tbl"');
  assert.equal(quoteId('MySQL', 'we`ird'), '`we``ird`');
  assert.equal(quoteId('PostgreSQL', 'we"ird'), '"we""ird"');
});

test('a table name cannot break out of its quoting', () => {
  const evil = 'users"; DROP TABLE users; --';
  const ref = formatTableRef('PostgreSQL', evil, 'public');
  assert.equal(ref, '"public"."users""; DROP TABLE users; --"');
  // one opening and one closing quote per identifier, everything else doubled
  assert.equal((ref.match(/"/g) || []).length % 2, 0);
});

test('update binds the value and every key column', () => {
  const w = new RowWriter(pg, 'PostgreSQL', '"public"."t"');
  const { sql, params } = w.update('name', "Robert'); DROP TABLE students;--", { id: 7 });
  assert.equal(sql, 'UPDATE "public"."t" SET "name" = $1 WHERE "id" = $2;');
  assert.deepEqual(params, ["Robert'); DROP TABLE students;--", 7]);
  assert.doesNotMatch(sql, /DROP/);
});

test('composite keys produce a conjunction over every column', () => {
  const w = new RowWriter(qm, 'MySQL', '`t`');
  const { sql, params } = w.delete({ order_id: 1, sku: 'A-1' });
  assert.equal(sql, 'DELETE FROM `t` WHERE `order_id` = ? AND `sku` = ?;');
  assert.deepEqual(params, [1, 'A-1']);
});

test('a null key column uses IS NULL, since NULL never equals NULL', () => {
  const w = new RowWriter(pg, 'PostgreSQL', '"t"');
  const { sql, params } = w.delete({ a: null, b: 2 });
  assert.equal(sql, 'DELETE FROM "t" WHERE "a" IS NULL AND "b" = $1;');
  assert.deepEqual(params, [2]);
});

test('placeholders stay in argument order for numbered dialects', () => {
  const w = new RowWriter(pg, 'PostgreSQL', '"t"');
  const { sql, params } = w.update('col', 'v', { k1: 'a', k2: 'b' });
  assert.equal(sql, 'UPDATE "t" SET "col" = $1 WHERE "k1" = $2 AND "k2" = $3;');
  assert.deepEqual(params, ['v', 'a', 'b']);
});

test('insert binds every value', () => {
  const w = new RowWriter(qm, 'SQLite', '"t"');
  const { sql, params } = w.insert({ a: 1, b: null, c: "x'y" });
  assert.equal(sql, 'INSERT INTO "t" ("a", "b", "c") VALUES (?, ?, ?);');
  assert.deepEqual(params, [1, null, "x'y"]);
});

test('refuses to update or delete without a row key', () => {
  const w = new RowWriter(pg, 'PostgreSQL', '"t"');
  assert.throws(() => w.update('a', 1, {}), /without a row key/);
  assert.throws(() => new RowWriter(pg, 'PostgreSQL', '"t"').delete({}), /without a row key/);
});

test('undefined binds as NULL rather than disappearing', () => {
  const w = new RowWriter(qm, 'SQLite', '"t"');
  const { params } = w.insert({ a: undefined });
  assert.deepEqual(params, [null]);
});

test('the inline fallback types values instead of quoting everything', () => {
  assert.equal(inlineParams('VALUES (?, ?, ?, ?)', [1, null, true, "it's"]), "VALUES (1, NULL, TRUE, 'it''s')");
});

test('the inline fallback escapes quotes so injection cannot close the literal', () => {
  const out = inlineParams('WHERE a = ?', ["'; DROP TABLE t; --"]);
  assert.equal(out, "WHERE a = '''; DROP TABLE t; --'");
});

test('updateMultiple binds multiple columns and every key column', () => {
  const w = new RowWriter(pg, 'PostgreSQL', '"public"."users"');
  const { sql, params } = w.updateMultiple({ name: 'Alice', age: 30 }, { id: 42 });
  assert.equal(sql, 'UPDATE "public"."users" SET "name" = $1, "age" = $2 WHERE "id" = $3;');
  assert.deepEqual(params, ['Alice', 30, 42]);
});

test('buildLimitOneQuery adapts TOP 1 for SQLServer and LIMIT 1 for other dialects', () => {
  const mssqlQuery = buildLimitOneQuery('SQLServer', '[dbo].[users]', '[id] = @p1');
  assert.equal(mssqlQuery, 'SELECT TOP 1 * FROM [dbo].[users] WHERE [id] = @p1');

  const pgQuery = buildLimitOneQuery('PostgreSQL', '"public"."users"', '"id" = $1');
  assert.equal(pgQuery, 'SELECT * FROM "public"."users" WHERE "id" = $1 LIMIT 1');

  const mysqlQuery = buildLimitOneQuery('MySQL', '`users`', '`id` = ?');
  assert.equal(mysqlQuery, 'SELECT * FROM `users` WHERE `id` = ? LIMIT 1');

  const sqliteQuery = buildLimitOneQuery('SQLite', '"users"', '"id" = ?');
  assert.equal(sqliteQuery, 'SELECT * FROM "users" WHERE "id" = ? LIMIT 1');
});
