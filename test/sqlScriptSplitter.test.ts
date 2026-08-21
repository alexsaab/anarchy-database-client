import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqlScriptRunner } from '../src/script/SqlScriptRunner.js';

const count = (sql: string) => SqlScriptRunner.split(sql).length;

test('splits on plain semicolons', () => {
  const s = SqlScriptRunner.split('SELECT 1;\nSELECT 2;');
  assert.deepEqual(s.map((x) => x.sql), ['SELECT 1', 'SELECT 2']);
  assert.deepEqual(s.map((x) => x.line), [1, 2]);
});

test('keeps a trailing statement without a semicolon', () => assert.equal(count('SELECT 1;\nSELECT 2'), 2));

test('ignores semicolons inside string literals', () => {
  const s = SqlScriptRunner.split("INSERT INTO t VALUES ('a;b');\nSELECT 3;");
  assert.equal(s.length, 2);
  assert.equal(s[0].sql, "INSERT INTO t VALUES ('a;b')");
});

test('handles doubled and backslash escaped quotes', () => {
  assert.equal(count("INSERT INTO t VALUES ('it''s; fine');\nSELECT 4;"), 2);
  assert.equal(count("INSERT INTO t VALUES ('a\\';b');\nSELECT 5;"), 2);
});

test('keeps leading comments attached to their statement', () => {
  const s = SqlScriptRunner.split('-- drop everything; really\nSELECT 6;');
  assert.equal(s.length, 1);
  assert.match(s[0].sql, /SELECT 6$/);
});

test('drops comment-only chunks', () => {
  assert.equal(count('-- nothing here\n'), 0);
  assert.equal(count('/* just; a comment */\n'), 0);
  assert.equal(count(''), 0);
});

test('treats hash and block comments as comments', () => {
  assert.equal(count('# comment; here\nSELECT 7;'), 1);
  assert.equal(count('/* multi;\n line; comment */\nSELECT 8;'), 1);
});

test('respects postgres dollar quoting', () => {
  assert.equal(count('CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;\nSELECT 9;'), 2);
  assert.equal(count('DO $tag$ BEGIN; PERFORM 1; END $tag$;\nSELECT 10;'), 2);
});

test('respects quoted identifiers', () => {
  assert.equal(count('SELECT "a;b" FROM t;\nSELECT 11;'), 2);
  assert.equal(count('SELECT `a;b` FROM t;\nSELECT 12;'), 2);
});

test('honours the mysql DELIMITER directive', () => {
  const script = 'DELIMITER $$\nCREATE TRIGGER x BEGIN INSERT INTO a VALUES(1); END$$\nDELIMITER ;\nSELECT 13;';
  const s = SqlScriptRunner.split(script);
  assert.equal(s.length, 2);
  assert.match(s[1].sql, /SELECT 13/);
});

test('reports the starting line of each statement', () => {
  const s = SqlScriptRunner.split('\n\n\nSELECT 14;\n\nSELECT 15;');
  assert.deepEqual(s.map((x) => x.line), [4, 6]);
});
