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

  let clipboardText = '';
  const sandbox = {
    acquireVsCodeApi: () => vscodeMock,
    document: documentMock,
    window: windowMock,
    navigator: { clipboard: { writeText: async (text: string) => { clipboardText = text; } } },
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
    Set,
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
          rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
          fields: [{ name: 'id', type: 'INT', isPrimaryKey: true }, { name: 'name', type: 'VARCHAR' }],
          totalCount: 2,
          costTimeMs: 5,
        },
        params: { page: 1, pageSize: 50 },
        foreignKeys: [],
      }
    });
  }, 'renderData threw error');

  // Test Column Pinning
  vm.runInContext('togglePinColumn("name")', sandbox);
  const pinnedFields = vm.runInContext('getDisplayFields()', sandbox);
  assert.equal(pinnedFields[0].name, 'name', 'pinned column moves to first position');
  assert.equal(pinnedFields[1].name, 'id', 'unpinned column follows');

  // Unpin column
  vm.runInContext('togglePinColumn("name")', sandbox);
  const unpinnedFields = vm.runInContext('getDisplayFields()', sandbox);
  assert.equal(unpinnedFields[0].name, 'id', 'unpinning restores natural order');

  // Test Range Selection
  vm.runInContext('selectionStart = { row: 0, col: 0 }; selectionEnd = { row: 1, col: 1 };', sandbox);
  const bounds = vm.runInContext('getSelectionBounds()', sandbox);
  assert.equal(bounds.minRow, 0);
  assert.equal(bounds.maxRow, 1);
  assert.equal(bounds.minCol, 0);
  assert.equal(bounds.maxCol, 1);

  // Test Copy Selected Range as TSV
  vm.runInContext('copySelectedRange("tsv")', sandbox);
  assert.ok(clipboardText.includes('id\tname'), 'TSV includes header row');
  assert.ok(clipboardText.includes('1\tAlice'), 'TSV includes first data row');
  assert.ok(clipboardText.includes('2\tBob'), 'TSV includes second data row');

  // Test Copy Selected Range as Markdown
  vm.runInContext('copySelectedRange("markdown")', sandbox);
  assert.ok(clipboardText.includes('| id | name |'), 'Markdown includes table header');
  assert.ok(clipboardText.includes('| 1 | Alice |'), 'Markdown includes table row');

  // Test Copy Selected Range as JSON
  vm.runInContext('copySelectedRange("json")', sandbox);
  const parsedJson = JSON.parse(clipboardText);
  assert.equal(parsedJson.length, 2);
  assert.equal(parsedJson[0].name, 'Alice');

  // Test Escape clears selection
  const keydownHandler = windowMock.handlers['keydown'];
  assert.ok(keydownHandler, 'keydown handler registered');
  keydownHandler({ key: 'Escape', ctrlKey: false, metaKey: false });
  assert.equal(vm.runInContext('getSelectionBounds()', sandbox), null, 'Escape clears cell selection');
});
