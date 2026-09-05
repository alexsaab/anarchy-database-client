// Minimal stand-in for the VS Code API so extension modules can be unit tested.
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose: () => {} }; }; }
  fire(e) { for (const h of this.handlers) h(e); }
  dispose() { this.handlers = []; }
}

const recorded = {
  info: [], warn: [], error: [], saveDialogPath: null, progressTitles: [], quickPickAnswer: null,
  // Queued answers for showInputBox, shifted one per call; a queued `null` stands
  // for the user dismissing the box. Prompts seen are recorded for assertions.
  inputBoxAnswers: [], inputBoxOptions: [],
  // Settings the module under test should see, keyed `section.key`.
  configuration: {},
};

module.exports = {
  __recorded: recorded,
  EventEmitter,
  ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class {
    constructor(value) { this.value = value || ''; }
    appendMarkdown(v) { this.value += v; return this; }
  },
  SnippetString: class {
    constructor(value) { this.value = value || ''; }
  },
  Position: class {
    constructor(line, character) { this.line = line; this.character = character; }
  },
  Range: class {
    constructor(start, end) { this.start = start; this.end = end; }
  },
  Hover: class {
    constructor(contents, range) { this.contents = contents; this.range = range; }
  },
  CompletionItem: class {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
      this.detail = '';
      this.documentation = '';
      this.insertText = undefined;
    }
  },
  CompletionItemKind: {
    Text: 0,
    Method: 1,
    Function: 2,
    Constructor: 3,
    Field: 4,
    Variable: 5,
    Class: 6,
    Interface: 7,
    Module: 8,
    Property: 9,
    Unit: 10,
    Value: 11,
    Enum: 12,
    Keyword: 13,
    Snippet: 14,
    Color: 15,
    File: 16,
    Reference: 17,
    Folder: 18,
    EnumMember: 19,
    Constant: 20,
    Struct: 21,
    Event: 22,
    Operator: 23,
    TypeParameter: 24,
  },
  TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ViewColumn: { One: 1, Two: 2 },
  ProgressLocation: { Notification: 15, Window: 10 },
  Uri: { file: (p) => ({ fsPath: p, path: p, scheme: 'file' }) },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  env: { language: 'en', clipboard: { writeText: async () => {} } },
  languages: {
    registerCompletionItemProvider: () => ({ dispose() {} }),
    registerHoverProvider: () => ({ dispose() {} }),
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} },
  workspace: {
    openTextDocument: async (o) => o,
    getConfiguration: (section) => ({
      // Real VS Code returns the supplied default when a setting is unset.
      get: (key, fallback) => {
        const full = section ? `${section}.${key}` : key;
        return Object.prototype.hasOwnProperty.call(recorded.configuration, full)
          ? recorded.configuration[full]
          : fallback;
      },
    }),
  },
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    createWebviewPanel: () => ({ webview: { postMessage() {}, onDidReceiveMessage() {} }, onDidDispose() {}, dispose() {} }),
    showInformationMessage: (m) => { recorded.info.push(m); return Promise.resolve(undefined); },
    showWarningMessage: (m) => { recorded.warn.push(m); return Promise.resolve(undefined); },
    showErrorMessage: (m) => { recorded.error.push(m); return Promise.resolve(undefined); },
    showSaveDialog: async () => (recorded.saveDialogPath ? { fsPath: recorded.saveDialogPath } : undefined),
    showTextDocument: async () => {},
    showInputBox: async (options) => {
      recorded.inputBoxOptions.push(options || {});
      if (recorded.inputBoxAnswers.length === 0) return undefined;
      const answer = recorded.inputBoxAnswers.shift();
      return answer === null ? undefined : answer;
    },
    showQuickPick: async (items) => {
      if (recorded.quickPickAnswer === 'ALL') return Array.isArray(items) ? items[0] : undefined;
      if (recorded.quickPickAnswer === 'PAGE') return Array.isArray(items) ? items[1] : undefined;
      return undefined;
    },
    withProgress: async (opts, task) => { recorded.progressTitles.push(opts.title); return task({ report() {} }, { isCancellationRequested: false }); },
  },
};
