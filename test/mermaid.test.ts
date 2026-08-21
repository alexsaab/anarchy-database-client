import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MermaidService } from '../src/diagram/MermaidService.js';

const schema = (over: any = {}) => ({
  table: { name: 'orders', schema: 'public' },
  columns: [
    { name: 'id', type: 'integer', isPrimaryKey: true, nullable: false },
    { name: 'customer_id', type: 'bigint', nullable: false },
    { name: 'total', type: 'NUMERIC(10, 2)', nullable: true },
  ],
  foreignKeys: [{ constraintName: 'fk1', columnName: 'customer_id', referencedTable: 'customers', referencedColumn: 'id' }],
  ...over,
});

test('emits an erDiagram header and one entity block per table', () => {
  const out = MermaidService.build('shop', [schema() as any]);
  assert.match(out, /^erDiagram\n/);
  assert.match(out, /"orders" \{/);
});

test('collapses parameterised types into one token', () => {
  const out = MermaidService.build('shop', [schema() as any]);
  assert.match(out, /numeric_10_2 total/);
  assert.doesNotMatch(out, /NUMERIC\(10, 2\)/);
});

test('marks primary and foreign keys, including both on one column', () => {
  const composite = schema({
    columns: [{ name: 'order_id', type: 'bigint', isPrimaryKey: true, nullable: false }],
    foreignKeys: [{ constraintName: 'fk1', columnName: 'order_id', referencedTable: 'customers', referencedColumn: 'id' }],
  });
  const out = MermaidService.build('shop', [composite as any]);
  assert.match(out, /bigint order_id PK, FK/);
});

test('renders one edge per constraint, not per column', () => {
  const composite = schema({
    foreignKeys: [
      { constraintName: 'fk_multi', columnName: 'a', referencedTable: 'customers', referencedColumn: 'x' },
      { constraintName: 'fk_multi', columnName: 'b', referencedTable: 'customers', referencedColumn: 'y' },
    ],
  });
  const out = MermaidService.build('shop', [composite as any]);
  const edges = out.split('\n').filter((l) => l.includes('||--o{'));
  assert.equal(edges.length, 1);
  assert.match(edges[0], /"a, b"/);
});

test('sanitises names but preserves the original in a comment', () => {
  const odd = schema({ columns: [{ name: 'e-mail address', type: 'text' }], foreignKeys: [] });
  const out = MermaidService.build('shop', [odd as any]);
  assert.match(out, /e-mail_address "e-mail address"/);
});

test('keeps unicode column names, which mermaid accepts', () => {
  const uni = schema({ columns: [{ name: 'данные', type: 'jsonb' }], foreignKeys: [] });
  assert.match(MermaidService.build('shop', [uni as any]), /jsonb данные/);
});

test('never emits a bare double quote inside a quoted string', () => {
  const nasty = schema({ columns: [{ name: 'note "quoted"', type: 'text' }], foreignKeys: [] });
  const out = MermaidService.build('shop', [nasty as any]);
  for (const line of out.split('\n')) {
    assert.ok((line.match(/"/g) || []).length % 2 === 0, `unbalanced quotes: ${line}`);
  }
});

test('gives distinct names to columns that sanitise identically', () => {
  const clash = schema({
    columns: [{ name: 'a b', type: 'text' }, { name: 'a-b', type: 'text' }, { name: 'a.b', type: 'text' }],
    foreignKeys: [],
  });
  const out = MermaidService.build('shop', [clash as any]);
  const names = out.split('\n').filter((l) => l.trim().startsWith('text ')).map((l) => l.trim().split(' ')[1]);
  assert.equal(new Set(names).size, names.length, `duplicate attribute names: ${names}`);
});

test('prefixes schemas only when more than one is present', () => {
  const one = MermaidService.build('db', [schema() as any]);
  assert.match(one, /"orders"/);
  const two = MermaidService.build('db', [schema() as any, schema({ table: { name: 't2', schema: 'other' }, foreignKeys: [] }) as any]);
  assert.match(two, /"public\.orders"/);
});

test('handles a table whose columns could not be read', () => {
  const out = MermaidService.build('db', [schema({ columns: [], foreignKeys: [] }) as any]);
  assert.match(out, /no_columns_readable/);
});
