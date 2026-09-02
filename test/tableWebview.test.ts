import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'vm';
import { TableWebviewProvider } from '../src/webview/TableWebviewProvider.js';

test('TableWebviewProvider getHtml script executes without error', () => {
  const html = (TableWebviewProvider as any).getHtml('User');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'script tag found');
  const scriptContent = match[1];

  // Create a mock DOM environment
  const elements: Record<string, any> = {};
  const getMockEl = (id: string) => {
    if (!elements[id]) {
      elements[id] = {
        id,
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        appendChild(child: any) { (this.children = this.children || []).push(child); },
        insertBefore(child: any) { (this.children = this.children || []).unshift(child); },
        addEventListener() {},
        setAttribute() {},
        getAttribute() { return null; },
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
    createTextNode(text: string) {
      return { text };
    },
    addEventListener(event: string, handler: any) {},
    activeElement: null,
  };

  const windowMock = {
    addEventListener(event: string, handler: any) {
      (this.handlers = this.handlers || {})[event] = handler;
    },
    handlers: {} as Record<string, any>,
    innerHeight: 800,
    innerWidth: 1200,
  };

  const postedMessages: any[] = [];
  const vscodeMock = {
    postMessage(msg: any) {
      postedMessages.push(msg);
    },
  };

  const sandbox = {
    acquireVsCodeApi: () => vscodeMock,
    document: documentMock,
    window: windowMock,
    navigator: { clipboard: { writeText: async () => {} } },
    alert: () => {},
    setTimeout: () => {},
    clearTimeout: () => {},
    console,
    parseInt,
    parseFloat,
    Math,
    Object,
    Array,
    JSON,
    String,
    Number,
    Boolean,
    isNaN,
  };

  vm.createContext(sandbox);
  // Execute the script!
  assert.doesNotThrow(() => {
    vm.runInContext(scriptContent, sandbox);
  }, 'Script threw runtime error');

  // Verify initial postMessage
  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].type, 'fetchData');
  assert.equal(postedMessages[0].params.page, 1);

  // Now simulate message event 'renderData'
  const messageHandler = windowMock.handlers['message'];
  assert.ok(messageHandler, 'message event handler registered');

  assert.doesNotThrow(() => {
    messageHandler({
      data: {
        type: 'renderData',
        tableName: 'User',
        result: {
          rows: [{ id: 1, name: 'Alice' }],
          fields: [{ name: 'id', type: 'INT', isPrimaryKey: true }, { name: 'name', type: 'VARCHAR' }],
          totalCount: 1,
          costTimeMs: 5,
        },
        params: { page: 1, pageSize: 50 },
        foreignKeys: [],
      }
    });
  }, 'renderData threw error');
});
