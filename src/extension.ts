import * as vscode from 'vscode';
import { ConnectionStorageService } from './storage/ConnectionStorage.js';
import { DatabaseTreeProvider } from './tree/DatabaseTreeProvider.js';
import { ConnectionNode } from './tree/ConnectionNode.js';
import { TableNode } from './tree/TableNode.js';
import { ColumnNode } from './tree/ColumnNode.js';
import { DatabaseNode } from './tree/DatabaseNode.js';
import { ConnectWebviewProvider } from './webview/ConnectWebviewProvider.js';
import { TableWebviewProvider } from './webview/TableWebviewProvider.js';
import { SqlCompletionProvider } from './provider/SqlCompletionProvider.js';
import { DriverManager } from './drivers/DriverManager.js';
import { IconHelper } from './util/IconHelper.js';
import { t } from './util/i18n.js';

export function activate(context: vscode.ExtensionContext) {
  console.log('Anarchy Database Client extension activated!');

  // Initialize IconHelper with extension path for SVG icon resolution
  IconHelper.setExtensionPath(context.extensionPath);

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
    vscode.commands.registerCommand('dbClient.copyTableName', (node: TableNode) => {
      if (node && node.table) {
        vscode.env.clipboard.writeText(node.table.name);
        vscode.window.showInformationMessage(
          t(`Copied table name "${node.table.name}"`, `Имя таблицы "${node.table.name}" скопировано`)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.copyColumnName', (node: ColumnNode) => {
      if (node && node.column) {
        vscode.env.clipboard.writeText(node.column.name);
        vscode.window.showInformationMessage(
          t(`Copied column name "${node.column.name}"`, `Имя колонки "${node.column.name}" скопировано`)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.showTableDdl', async (node: TableNode) => {
      if (node && node.table) {
        try {
          const driver = await DriverManager.getInstance().getDriver(node.connectionConfig, node.password, node.sshPassword);
          const columns = await driver.getColumns(node.table.name, node.connectionConfig.database, node.table.schema);

          let ddl = `-- DDL for table ${node.table.name}\nCREATE TABLE "${node.table.name}" (\n`;
          const colDefs = columns.map(
            (c) => `  "${c.name}" ${c.type}${c.isPrimaryKey ? ' PRIMARY KEY' : ''}${c.nullable ? '' : ' NOT NULL'}${c.defaultValue ? ` DEFAULT ${c.defaultValue}` : ''}`
          );
          ddl += colDefs.join(',\n');
          ddl += '\n);';

          const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: ddl });
          await vscode.window.showTextDocument(doc);
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to generate DDL: ${e.message}`);
        }
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
      new SqlCompletionProvider(),
      ' ', '.'
    )
  );
}

export function deactivate() {
  DriverManager.getInstance().disconnectAll();
}
