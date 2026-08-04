import * as vscode from 'vscode';
import { ConnectionStorageService } from './storage/ConnectionStorage.js';
import { DatabaseTreeProvider } from './tree/DatabaseTreeProvider.js';
import { ConnectionNode } from './tree/ConnectionNode.js';
import { TableNode } from './tree/TableNode.js';
import { DatabaseNode } from './tree/DatabaseNode.js';
import { ConnectWebviewProvider } from './webview/ConnectWebviewProvider.js';
import { TableWebviewProvider } from './webview/TableWebviewProvider.js';
import { SqlCompletionProvider } from './provider/SqlCompletionProvider.js';
import { DriverManager } from './drivers/DriverManager.js';
import { t } from './util/i18n.js';

export function activate(context: vscode.ExtensionContext) {
  console.log('Anarchy Database Client extension activated!');

  const storageService = new ConnectionStorageService(context);
  const treeProvider = new DatabaseTreeProvider(storageService);

  // Register Tree View
  vscode.window.registerTreeDataProvider('database-client-explorer', treeProvider);

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.addConnection', () => {
      ConnectWebviewProvider.show(context, storageService, () => treeProvider.refresh());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.editConnection', async (node: ConnectionNode) => {
      if (node && node.config) {
        const pass = await storageService.getPassword(node.config.id);
        const sshPass = await storageService.getSshPassword(node.config.id);
        ConnectWebviewProvider.show(
          context,
          storageService,
          () => treeProvider.refresh(),
          node.config,
          pass,
          sshPass
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.refreshTree', () => {
      treeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.deleteConnection', async (node: ConnectionNode) => {
      if (node && node.config) {
        const title = t(
          `Are you sure you want to delete connection "${node.config.name}"?`,
          `Вы уверены, что хотите удалить подключение "${node.config.name}"?`
        );
        const btnLabel = t('Delete', 'Удалить');
        const confirm = await vscode.window.showWarningMessage(title, { modal: true }, btnLabel);

        if (confirm === btnLabel) {
          await storageService.deleteConnection(node.config.id);
          await DriverManager.getInstance().removeDriver(node.config.id);
          treeProvider.refresh();
          vscode.window.showInformationMessage(
            t(`Deleted connection "${node.config.name}"`, `Удалено подключение "${node.config.name}"`)
          );
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.openTable', (node: TableNode) => {
      if (node && node instanceof TableNode) {
        TableWebviewProvider.openTable(node);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.newQuery', async (node?: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = node.connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        TableWebviewProvider.openQueryConsole(config, pass);
      } else {
        const sqlComment = t('-- Enter your SQL query below\nSELECT 1;', '-- Введите ваш SQL-запрос ниже\nSELECT 1;');
        const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sqlComment });
        await vscode.window.showTextDocument(doc);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.runQuery', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const selection = editor.selection;
      const sql = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
      if (!sql.trim()) {
        vscode.window.showWarningMessage(t('No SQL query to execute.', 'Нет SQL-запроса для выполнения.'));
        return;
      }

      const execMsg = t('Executing SQL Query:\n', 'Выполнение SQL-запроса:\n');
      vscode.window.showInformationMessage(`${execMsg}${sql.slice(0, 100)}...`);
    })
  );

  // Register SQL IntelliSense
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'sql' },
      new SqlCompletionProvider(),
      ' ', '.'
    )
  );
}

export function deactivate() {
  DriverManager.getInstance().disconnectAll();
}
