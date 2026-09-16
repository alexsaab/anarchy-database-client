import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'vm';
import { QueryBuilderWebviewProvider } from '../src/webview/QueryBuilderWebviewProvider.js';

test('QueryBuilderWebviewProvider getHtml script executes and handles PostgreSQL dialect correctly', () => {
  const mockTables = [
    {
      name: 'users',
      schema: 'public',
      columns: [
        { name: 'id', type: 'integer', isPrimaryKey: true },
        { name: 'email', type: 'varchar(255)' },
      ],
    },
    {
      name: 'orders',
      schema: 'public',
      columns: [
        { name: 'id', type: 'integer', isPrimaryKey: true },
        { name: 'user_id', type: 'integer' },
        { name: 'total', type: 'decimal(10,2)' },
      ],
    },
  ];

  const html = (QueryBuilderWebviewProvider as any).getHtml(
    'Postgres Hermes',
    'PostgreSQL',
    ['postgres', 'hermes'],
    'hermes',
    ['public', 'auth'],
    'public',
    mockTables
  );

  assert.ok(html.includes('Visual Query Builder'), 'Title included');
  assert.ok(html.includes('hermes'), 'Database included');
  assert.ok(html.includes('public'), 'Schema included');

  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'script tag found');
  const scriptContent = match[1];

  const elements: Record<string, any> = {};
  const getMockEl = (id: string) => {
    if (!elements[id]) {
      elements[id] = {
        id,
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        appendChild(child: any) { (this.children = this.children || []).push(child); },
        addEventListener() {},
        setAttribute() {},
        value: '',
        innerText: '',
        textContent: '',
        innerHTML: '',
        children: [],
      };
    }
    return elements[id];
  };

  const documentMock = {
    getElementById(id: string) {
      return getMockEl(id);
    },
    createElement(tag: string) {
      return getMockEl('mock_' + tag + '_' + Math.random());
    },
    querySelectorAll(selector: string) {
      if (selector.includes('columnsCheckboxList')) {
        return [
          { value: 'id', checked: true },
          { value: 'email', checked: true },
        ];
      }
      return [];
    },
    addEventListener() {},
  };

  const windowMock = {
    addEventListener(event: string, handler: any) {
      (this.handlers = this.handlers || {})[event] = handler;
    },
    handlers: {} as Record<string, any>,
  };

  const postedMessages: any[] = [];
  const vscodeMock = {
    postMessage(msg: any) {
      postedMessages.push(msg);
    },
  };

  class MockOption {
    text: string;
    value: string;
    constructor(text: string, value: string) {
      this.text = text;
      this.value = value;
    }
  }

  const sandbox = {
    acquireVsCodeApi: () => vscodeMock,
    document: documentMock,
    window: windowMock,
    Option: MockOption,
    parseInt: Number.parseInt,
    String,
    Number,
    Boolean,
    Array,
  };

  vm.createContext(sandbox);
  assert.doesNotThrow(() => {
    vm.runInContext(scriptContent, sandbox);
  }, 'QueryBuilder script executed without error');

  // Verify PostgreSQL dialect quoting
  const generatedSql = vm.runInContext('generateSql()', sandbox);
  assert.ok(generatedSql.includes('FROM "public"."users"'), 'Postgres quotes schema and table with double quotes');
  assert.ok(generatedSql.includes('"users"."id"'), 'Postgres quotes columns with double quotes');
  assert.ok(!generatedSql.includes('`'), 'Postgres SQL does NOT contain backticks');

  // Verify joining tables
  vm.runInContext('joins.push({ type: "INNER JOIN", table: "orders", col1: "id", col2: "user_id" })', sandbox);
  const sqlWithJoin = vm.runInContext('generateSql()', sandbox);
  assert.ok(sqlWithJoin.includes('INNER JOIN "public"."orders" ON "users"."id" = "orders"."user_id"'), 'JOIN statement properly generated');

  // Verify WHERE condition
  vm.runInContext('wheres.push({ col: "email", op: "=", val: "test@example.com" })', sandbox);
  const sqlWithWhere = vm.runInContext('generateSql()', sandbox);
  assert.ok(sqlWithWhere.includes(`WHERE "users"."email" = 'test@example.com'`), 'WHERE clause properly generated');
});
