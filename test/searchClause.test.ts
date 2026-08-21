import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchClause, sqliteSearchClause } from '../src/sql/SearchClause.js';

const cols = [{ name: 'id', type: 'int' }, { name: 'name', type: 'text' }] as any;

test('builds an OR across every column with one bound param each', () => {
  const c = buildSearchClause('PostgreSQL', cols, 'ada');
  assert.equal(c.sql, `(CAST("id" AS TEXT) ILIKE ? ESCAPE '\\' OR CAST("name" AS TEXT) ILIKE ? ESCAPE '\\')`);
  assert.deepEqual(c.params, ['%ada%', '%ada%']);
});

test('uses the dialect quoting and operator', () => {
  assert.match(buildSearchClause('MySQL', cols, 'x').sql, /`id`/);
  assert.match(buildSearchClause('MySQL', cols, 'x').sql, /LIKE/);
  assert.match(buildSearchClause('PostgreSQL', cols, 'x').sql, /ILIKE/);
});

test('LIKE wildcards in the term are escaped, not honoured', () => {
  assert.deepEqual(buildSearchClause('PostgreSQL', cols, '100%').params, ['%100\\%%', '%100\\%%']);
  assert.deepEqual(buildSearchClause('PostgreSQL', cols, 'a_b').params, ['%a\\_b%', '%a\\_b%']);
  assert.deepEqual(buildSearchClause('PostgreSQL', cols, 'back\\slash').params, ['%back\\\\slash%', '%back\\\\slash%']);
});

test('the term never reaches the SQL text', () => {
  const c = buildSearchClause('PostgreSQL', cols, "'; DROP TABLE t; --");
  assert.doesNotMatch(c.sql, /DROP/);
  assert.equal(c.params[0], "%'; DROP TABLE t; --%");
});

test('an empty term filters nothing', () => {
  for (const term of ['', '   ', null as any, undefined as any]) {
    const c = buildSearchClause('PostgreSQL', cols, term);
    assert.equal(c.sql, '');
    assert.deepEqual(c.params, []);
  }
});

test('no columns means no clause', () => {
  assert.equal(buildSearchClause('PostgreSQL', [], 'x').sql, '');
});

test('sqlite folds case explicitly because LIKE is ascii-only', () => {
  const c = sqliteSearchClause(cols, 'Ada');
  assert.match(c.sql, /UPPER\(CAST\("id" AS TEXT\)\) LIKE \?/);
  assert.deepEqual(c.params, ['%ADA%', '%ADA%']);
});
