import * as vscode from 'vscode';
import { ConnectionStorageService } from './storage/ConnectionStorage.js';
import { DatabaseTreeProvider } from './tree/DatabaseTreeProvider.js';
import { ConnectionNode } from './tree/ConnectionNode.js';
import { DatabaseNode } from './tree/DatabaseNode.js';
import { TableNode } from './tree/TableNode.js';
import { ConnectWebviewProvider } from './webview/ConnectWebviewProvider.js';
import { TableWebviewProvider } from './webview/TableWebviewProvider.js';
import { TableDesignWebviewProvider } from './webview/TableDesignWebviewProvider.js';
import { ErdWebviewProvider } from './webview/ErdWebviewProvider.js';
import { ProcessListWebviewProvider } from './webview/ProcessListWebviewProvider.js';
import { DatabaseDumpService } from './dump/DatabaseDumpService.js';
import { MockDataGenerator } from './mock/MockDataGenerator.js';
import { DriverManager } from './drivers/DriverManager.js';
import { ScriptNode } from './tree/ScriptNode.js';
import { IconHelper } from './util/IconHelper.js';
import { t } from './util/i18n.js';

export function activate(context: vscode.ExtensionContext) {
  IconHelper.setExtensionPath(context.extensionPath);

  const storageService = new ConnectionStorageService(context);
  const treeProvider = new DatabaseTreeProvider(storageService);

  // Register all tree view IDs to prevent any extension ID conflict
  vscode.window.registerTreeDataProvider('database-client-explorer', treeProvider);
  vscode.window.registerTreeDataProvider('dbClientView', treeProvider);
  vscode.window.registerTreeDataProvider('anarchy-database-client-explorer', treeProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.addConnection', () => {
      ConnectWebviewProvider.show(context, storageService, () => {
        treeProvider.refresh();
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.editConnection', async (node: ConnectionNode) => {
      if (node && node.config) {
        const password = await storageService.getPassword(node.config.id);
        const sshPassword = await storageService.getSshPassword(node.config.id);
        ConnectWebviewProvider.show(
          context,
          storageService,
          () => {
            treeProvider.refresh();
          },
          node.config,
          password,
          sshPassword
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.deleteConnection', async (node: ConnectionNode) => {
      if (node && node.config) {
        const confirmText = t(`Are you sure you want to delete connection "${node.config.name}"?`, `Вы уверены, что хотите удалить подключение "${node.config.name}"?`);
        const result = await vscode.window.showWarningMessage(confirmText, { modal: true }, t('Delete', 'Удалить'));
        if (result === t('Delete', 'Удалить')) {
          await storageService.deleteConnection(node.config.id);
          await DriverManager.getInstance().removeDriver(node.config.id);
          treeProvider.refresh();
          vscode.window.showInformationMessage(t(`Deleted "${node.config.name}"`, `Удалено "${node.config.name}"`));
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.refresh', () => {
      treeProvider.refresh();
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
    vscode.commands.registerCommand('dbClient.designTable', (node: TableNode) => {
      if (node && node instanceof TableNode) {
        TableDesignWebviewProvider.show(node);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.openScript', async (node: ScriptNode) => {
      if (node && node instanceof ScriptNode) {
        try {
          const driver = await DriverManager.getInstance().getDriver(node.connectionConfig, node.password, node.sshPassword);
          const scriptSql = await driver.getScript(node.objectName, node.objectType, node.connectionConfig.database, node.schemaName);
          const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: scriptSql });
          await vscode.window.showTextDocument(doc);
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to open DDL script: ${e.message}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.queryConsole', async (node: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = node.connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        const sshPass = (node as ConnectionNode).sshPassword;
        TableWebviewProvider.openQueryConsole(config, pass, sshPass);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.dumpDatabase', async (node: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = node.connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        const sshPass = (node as ConnectionNode).sshPassword;
        await DatabaseDumpService.dumpDatabase(config, pass, sshPass);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.importSql', async (node: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = node.connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        const sshPass = (node as ConnectionNode).sshPassword;
        await DatabaseDumpService.importSqlFile(config, pass, sshPass);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.openErd', async (node: DatabaseNode) => {
      if (node) {
        await ErdWebviewProvider.show(node.connectionConfig, node.password, node.sshPassword);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.processList', async (node: ConnectionNode) => {
      if (node) {
        await ProcessListWebviewProvider.show(node.config, node.password, node.sshPassword);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.generateMockData', async (node: TableNode) => {
      if (node && node instanceof TableNode) {
        await MockDataGenerator.generateForTable(node);
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

  // Register SQL IntelliSense
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'sql' },
      {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
          const keywords = [
            'SELECT', 'FROM', 'WHERE', 'INSERT INTO', 'UPDATE', 'DELETE FROM',
            'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'GROUP BY', 'ORDER BY',
            'HAVING', 'LIMIT', 'OFFSET', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
            'CREATE VIEW', 'CREATE PROCEDURE', 'CREATE FUNCTION', 'CREATE TRIGGER',
          ];

          return keywords.map((k) => new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword));
        },
      }
    )
  );
}

export function deactivate() {
  DriverManager.getInstance().disconnectAll();
}
