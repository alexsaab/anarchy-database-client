import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyColumnsFor, buildKeysetClause, keysetOrderBy, cursorFrom } from '../src/sql/Keyset.js';

const cols = [
  { name: 'id', type: 'int', isPrimaryKey: true, nullable: false },
  { name: 'name', type: 'text', nullable: false },
  { name: 'note', type: 'text', nullable: true },
] as any;

test('the primary key alone gives a total order', () => {
  assert.deepEqual(keyColumnsFor(cols), [{ name: 'id', direction: 'ASC' }]);
});

test('a sort column is tie-broken by the primary key', () => {
  assert.deepEqual(keyColumnsFor(cols, 'name', 'DESC'), [
    { name: 'name', direction: 'DESC' },
    { name: 'id', direction: 'DESC' },
  ]);
});

test('sorting by the primary key does not repeat it', () => {
  assert.deepEqual(keyColumnsFor(cols, 'id', 'ASC'), [{ name: 'id', direction: 'ASC' }]);
});

test('no primary key means no keyset paging', () => {
  assert.equal(keyColumnsFor([{ name: 'a', type: 'text' }] as any), null);
});

test('a nullable sort column falls back to OFFSET', () => {
  // NULLs make every comparison unknown, which would silently drop rows.
  assert.equal(keyColumnsFor(cols, 'note', 'ASC'), null);
});

test('an unknown sort column falls back to OFFSET', () => {
  assert.equal(keyColumnsFor(cols, 'nope', 'ASC'), null);
});

test('builds an expanded lexicographic comparison, not a row-value constructor', () => {
  const keys = [{ name: 'name', direction: 'ASC' as const }, { name: 'id', direction: 'ASC' as const }];
  const c = buildKeysetClause('PostgreSQL', keys, { name: 'Ada', id: 7 }, 'next');
  assert.equal(c.sql, '(("name" > ?) OR ("name" = ? AND "id" > ?))');
  assert.deepEqual(c.params, ['Ada', 'Ada', 7]);
  assert.equal(c.orderBy, '"name" ASC, "id" ASC');
  assert.equal(c.reversed, false);
});

test('DESC columns invert the comparison', () => {
  const keys = [{ name: 'id', direction: 'DESC' as const }];
  const c = buildKeysetClause('PostgreSQL', keys, { id: 10 }, 'next');
  assert.equal(c.sql, '(("id" < ?))');
  assert.deepEqual(c.params, [10]);
});

test('going backwards inverts the comparison and the order', () => {
  const keys = [{ name: 'id', direction: 'ASC' as const }];
  const c = buildKeysetClause('PostgreSQL', keys, { id: 10 }, 'prev');
  assert.equal(c.sql, '(("id" < ?))');
  assert.equal(c.orderBy, '"id" DESC');
  assert.equal(c.reversed, true, 'rows come back reversed and must be flipped');
});

test('backwards over a DESC column comes out forwards again', () => {
  const keys = [{ name: 'id', direction: 'DESC' as const }];
  const c = buildKeysetClause('PostgreSQL', keys, { id: 10 }, 'prev');
  assert.equal(c.sql, '(("id" > ?))');
  assert.equal(c.orderBy, '"id" ASC');
});

test('uses the dialect quoting', () => {
  const keys = [{ name: 'id', direction: 'ASC' as const }];
  assert.match(buildKeysetClause('MySQL', keys, { id: 1 }, 'next').sql, /`id`/);
  assert.match(buildKeysetClause('SQLServer', keys, { id: 1 }, 'next').sql, /\[id\]/);
});

test('a missing or null cursor value disables the clause', () => {
  const keys = [{ name: 'id', direction: 'ASC' as const }];
  assert.equal(buildKeysetClause('PostgreSQL', keys, {}, 'next').sql, '');
  assert.equal(buildKeysetClause('PostgreSQL', keys, { id: null }, 'next').sql, '');
});

test('the cursor carries only key columns', () => {
  const keys = [{ name: 'id', direction: 'ASC' as const }];
  assert.deepEqual(cursorFrom({ id: 3, name: 'x', big: 'payload' }, keys), { id: 3 });
});

test('the first page orders without a cursor', () => {
  assert.equal(
    keysetOrderBy('PostgreSQL', [{ name: 'a', direction: 'ASC' }, { name: 'b', direction: 'DESC' }]),
    '"a" ASC, "b" DESC'
  );
});
