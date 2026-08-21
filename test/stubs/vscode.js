// Minimal stand-in for the VS Code API so extension modules can be unit tested.
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose: () => {} }; }; }
  fire(e) { for (const h of this.handlers) h(e); }
  dispose() { this.handlers = []; }
}

const recorded = { info: [], warn: [], error: [], saveDialogPath: null, progressTitles: [] };

module.exports = {
  __recorded: recorded,
  EventEmitter,
  ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class {
    constructor(value) { this.value = value || ''; }
    appendMarkdown(v) { this.value += v; return this; }
  },
  TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ViewColumn: { One: 1, Two: 2 },
  ProgressLocation: { Notification: 15, Window: 10 },
  Uri: { file: (p) => ({ fsPath: p, path: p, scheme: 'file' }) },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  env: { language: 'en', clipboard: { writeText: async () => {} } },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  workspace: { openTextDocument: async (o) => o, getConfiguration: () => ({ get: () => undefined }) },
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    createWebviewPanel: () => ({ webview: { postMessage() {}, onDidReceiveMessage() {} }, onDidDispose() {}, dispose() {} }),
    showInformationMessage: (m) => { recorded.info.push(m); return Promise.resolve(undefined); },
    showWarningMessage: (m) => { recorded.warn.push(m); return Promise.resolve(undefined); },
    showErrorMessage: (m) => { recorded.error.push(m); return Promise.resolve(undefined); },
    showSaveDialog: async () => (recorded.saveDialogPath ? { fsPath: recorded.saveDialogPath } : undefined),
    showTextDocument: async () => {},
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => { recorded.progressTitles.push(opts.title); return task({ report() {} }, { isCancellationRequested: false }); },
  },
};
