import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyParameters,
  describeParameter,
  extractParameters,
  formatLiteral,
  hasParameters,
} from '../src/sql/QueryParameters.js';

test('extracts named placeholders in first-appearance order', () => {
  const params = extractParameters('SELECT * FROM users WHERE name = :name AND age > :min_age');
  assert.deepEqual(params.map((p) => p.key), ['name', 'min_age']);
  assert.deepEqual(params.map((p) => p.style), ['named', 'named']);
});

test('a repeated named placeholder is one parameter with several offsets', () => {
  const params = extractParameters('SELECT :id, :id FROM t WHERE x = :id');
  assert.equal(params.length, 1);
  assert.equal(params[0].offsets.length, 3);
});

test('every ? is its own parameter', () => {
  const params = extractParameters('SELECT * FROM t WHERE a = ? AND b = ?');
  assert.deepEqual(params.map((p) => p.key), ['1', '2']);
  assert.deepEqual(params.map((p) => p.style), ['anonymous', 'anonymous']);
});

test('numbered placeholders are recognised and de-duplicated', () => {
  const params = extractParameters('SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $1');
  assert.deepEqual(params.map((p) => p.key), ['1', '2']);
  assert.equal(params[0].offsets.length, 2);
});

test('placeholders inside string literals are ignored', () => {
  assert.deepEqual(extractParameters("SELECT ':name', '?', '$1' FROM t"), []);
});

test("doubled quotes do not end a literal early", () => {
  assert.deepEqual(extractParameters("SELECT 'it''s :not_a_param' FROM t"), []);
});

test('placeholders inside comments are ignored', () => {
  assert.deepEqual(extractParameters('SELECT 1 -- :nope\n/* $1 and ? */ FROM t'), []);
  assert.equal(extractParameters('SELECT 1 /* /* :deep */ :real */ FROM t WHERE x = :yes').length, 1);
});

test('PostgreSQL casts and dollar-quoted bodies are not placeholders', () => {
  assert.deepEqual(extractParameters("SELECT '5'::int, id::text FROM t"), []);
  assert.deepEqual(extractParameters('CREATE FUNCTION f() AS $$ SELECT :x, $1 $$ LANGUAGE sql'), []);
});

test('MSSQL @params are recognised but @@globals are not', () => {
  const params = extractParameters('SELECT @@VERSION, * FROM t WHERE id = @userId');
  assert.deepEqual(params.map((p) => p.key), ['userId']);
});

test('quoted identifiers hide placeholder-looking text', () => {
  assert.deepEqual(extractParameters('SELECT "weird:col", `odd?col` FROM t'), []);
});

test('formatLiteral quotes strings and passes numbers, booleans and NULL through', () => {
  assert.equal(formatLiteral('42'), '42');
  assert.equal(formatLiteral('-3.5'), '-3.5');
  assert.equal(formatLiteral('true'), 'true');
  assert.equal(formatLiteral('null'), 'NULL');
  assert.equal(formatLiteral('Alice'), "'Alice'");
  assert.equal(formatLiteral("'already quoted'"), "'already quoted'");
});

test('formatLiteral escapes embedded quotes so a value cannot break out', () => {
  assert.equal(formatLiteral("O'Connor"), "'O''Connor'");
  assert.equal(formatLiteral("x'; DROP TABLE users; --"), "'x''; DROP TABLE users; --'");
});

test('applyParameters substitutes every occurrence', () => {
  const sql = 'SELECT * FROM users WHERE name = :name OR alias = :name AND age > :age';
  const out = applyParameters(sql, new Map([['name', "O'Brien"], ['age', '18']]));
  assert.equal(out, "SELECT * FROM users WHERE name = 'O''Brien' OR alias = 'O''Brien' AND age > 18");
});

test('applyParameters leaves text inside literals alone', () => {
  const out = applyParameters("SELECT ':name' AS lit, :name AS real FROM t", new Map([['name', 'x']]));
  assert.equal(out, "SELECT ':name' AS lit, 'x' AS real FROM t");
});

test('applyParameters fills each ? independently', () => {
  const out = applyParameters('SELECT * FROM t WHERE a = ? AND b = ?', new Map([
    ['anonymous:1', '1'],
    ['anonymous:2', 'two'],
  ]));
  assert.equal(out, "SELECT * FROM t WHERE a = 1 AND b = 'two'");
});

test('an unanswered placeholder is left in place rather than silently emptied', () => {
  const out = applyParameters('SELECT * FROM t WHERE a = :a AND b = :b', new Map([['a', '1']]));
  assert.equal(out, 'SELECT * FROM t WHERE a = 1 AND b = :b');
});

test('hasParameters and describeParameter', () => {
  assert.equal(hasParameters('SELECT 1'), false);
  assert.equal(hasParameters('SELECT :x'), true);
  assert.equal(describeParameter(extractParameters('SELECT :x')[0]), ':x');
  assert.equal(describeParameter(extractParameters('SELECT ?')[0]), '? #1');
});
