import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqlCompletionProvider } from '../src/provider/SqlCompletionProvider.js';
import { SqlHoverProvider } from '../src/provider/SqlHoverProvider.js';
import { SchemaMetadataCache } from '../src/provider/SchemaMetadataCache.js';

// Mock Document and Position helper
function createMockDoc(text: string, line: number, character: number) {
  const lines = text.split('\n');
  return {
    lineAt: (pos: any) => ({ text: lines[pos.line] || '' }),
    getText: (range?: any) => {
      if (range) {
        return text.substring(range.startChar || 0, range.endChar || text.length);
      }
      return text;
    },
    getWordRangeAtPosition: (pos: any, regex: RegExp) => {
      const currentLine = lines[pos.line] || '';
      const match = currentLine.match(regex);
      if (match) {
        return { start: pos, end: pos };
      }
      return null;
    }
  };
}

test('SqlCompletionProvider suggests SQL keywords and functions', () => {
  const provider = new SqlCompletionProvider();
  const doc = createMockDoc('SEL', 0, 3);
  const items = provider.provideCompletionItems(doc as any, { line: 0, character: 3 } as any, {} as any, {} as any) as any[];

  assert.ok(items.length > 0);
  assert.ok(items.some((i) => i.label === 'SELECT'));
  assert.ok(items.some((i) => i.label === 'COUNT'));
  assert.ok(items.some((i) => i.label === 'COALESCE'));
});

test('SqlCompletionProvider suggests schema tables and columns from cache', () => {
  const tableMap = new Map();
  tableMap.set('users', {
    table: { name: 'users', type: 'table' },
    columns: [
      { name: 'id', type: 'bigint', isPrimaryKey: true, nullable: false },
      { name: 'email', type: 'varchar(255)', nullable: false },
      { name: 'created_at', type: 'timestamp', nullable: true },
    ],
    foreignKeys: [],
  });
  tableMap.set('orders', {
    table: { name: 'orders', type: 'table' },
    columns: [
      { name: 'id', type: 'bigint', isPrimaryKey: true, nullable: false },
      { name: 'user_id', type: 'bigint', nullable: false },
      { name: 'total', type: 'numeric(10,2)', nullable: false },
    ],
    foreignKeys: [
      { constraintName: 'fk_user', columnName: 'user_id', referencedTable: 'users', referencedColumn: 'id' }
    ],
  });

  SchemaMetadataCache.getInstance().setMockMetadata('conn1', {
    connectionId: 'conn1',
    connectionName: 'Production DB',
    tables: tableMap,
  });

  const provider = new SqlCompletionProvider();
  const doc = createMockDoc('SELECT * FROM ', 0, 14);
  const items = provider.provideCompletionItems(doc as any, { line: 0, character: 14 } as any, {} as any, {} as any) as any[];

  assert.ok(items.some((i) => i.label === 'users'));
  assert.ok(items.some((i) => i.label === 'orders'));
  assert.ok(items.some((i) => i.label === 'email'));
});

test('SqlCompletionProvider suggests table columns on dot completion', () => {
  const provider = new SqlCompletionProvider();
  const doc = createMockDoc('SELECT users.', 0, 13);
  const items = provider.provideCompletionItems(doc as any, { line: 0, character: 13 } as any, {} as any, {} as any) as any[];

  assert.ok(items.some((i) => i.label === 'id'));
  assert.ok(items.some((i) => i.label === 'email'));
  assert.ok(items.some((i) => i.label === 'created_at'));
  // Should not contain orders table specific columns
  assert.ok(!items.some((i) => i.label === 'total'));
});

test('SqlCompletionProvider suggests foreign key ON joins', () => {
  const provider = new SqlCompletionProvider();
  const doc = createMockDoc('SELECT * FROM users JOIN orders ON ', 0, 35);
  const items = provider.provideCompletionItems(doc as any, { line: 0, character: 35 } as any, {} as any, {} as any) as any[];

  assert.ok(items.some((i) => i.label === 'orders.user_id = users.id'));
});

test('SqlCompletionProvider suggests smart JOIN table and ON clause immediately after JOIN keyword', () => {
  const provider = new SqlCompletionProvider();
  const doc = createMockDoc('SELECT * FROM users JOIN ', 0, 25);
  const items = provider.provideCompletionItems(doc as any, { line: 0, character: 25 } as any, {} as any, {} as any) as any[];

  assert.ok(items.some((i) => i.label === 'orders ON orders.user_id = users.id'));
});

test('SqlHoverProvider displays table column schema info on hover', () => {
  const hoverProvider = new SqlHoverProvider();
  const doc = {
    getWordRangeAtPosition: () => ({ start: 0, end: 5 }),
    getText: () => 'users',
  };

  const hover = hoverProvider.provideHover(doc as any, { line: 0, character: 2 } as any, {} as any) as any;
  assert.ok(hover);
  assert.match(hover.contents.value, /Table `users`/);
  assert.match(hover.contents.value, /`email`/);
  assert.match(hover.contents.value, /🔑 PK/);
});
