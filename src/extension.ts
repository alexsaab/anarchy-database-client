import * as vscode from 'vscode';
import { ConnectionStorageService } from './storage/ConnectionStorage.js';
import { DatabaseTreeProvider } from './tree/DatabaseTreeProvider.js';
import { ConnectionNode } from './tree/ConnectionNode.js';
import { DatabaseNode } from './tree/DatabaseNode.js';
import { TableNode } from './tree/TableNode.js';
import { TableGroupNode } from './tree/TableGroupNode.js';
import { ViewGroupNode } from './tree/ViewGroupNode.js';
import { FunctionGroupNode } from './tree/FunctionGroupNode.js';
import { ProcedureGroupNode } from './tree/ProcedureGroupNode.js';
import { TriggerGroupNode } from './tree/TriggerGroupNode.js';
import { QueryGroupNode } from './tree/QueryGroupNode.js';
import { QueryFileNode } from './tree/QueryFileNode.js';
import { QueryFileStorage } from './storage/QueryFileStorage.js';
import { ConnectWebviewProvider } from './webview/ConnectWebviewProvider.js';
import { TableWebviewProvider } from './webview/TableWebviewProvider.js';
import { TableDesignWebviewProvider } from './webview/TableDesignWebviewProvider.js';
import { ErdWebviewProvider } from './webview/ErdWebviewProvider.js';
import { ProcessListWebviewProvider } from './webview/ProcessListWebviewProvider.js';
import { DatabaseDumpService } from './dump/DatabaseDumpService.js';
import { MockDataGenerator } from './mock/MockDataGenerator.js';
import { DriverManager } from './drivers/DriverManager.js';
import { ScriptNode } from './tree/ScriptNode.js';
import { SchemaDiffWebviewProvider } from './webview/SchemaDiffWebviewProvider.js';
import { QueryBuilderWebviewProvider } from './webview/QueryBuilderWebviewProvider.js';
import { ExplainWebviewProvider } from './webview/ExplainWebviewProvider.js';
import { RedisWebviewProvider } from './webview/RedisWebviewProvider.js';
import { DataSyncWebviewProvider } from './webview/DataSyncWebviewProvider.js';
import { AiSqlAssistantWebviewProvider } from './webview/AiSqlAssistantWebviewProvider.js';
import { StatusBarHealthMonitor } from './status/StatusBarHealthMonitor.js';
import { IconHelper } from './util/IconHelper.js';
import { t } from './util/i18n.js';

export function activate(context: vscode.ExtensionContext) {
  IconHelper.setExtensionPath(context.extensionPath);

  const storageService = new ConnectionStorageService(context);
  const treeProvider = new DatabaseTreeProvider(context, storageService);

  // Register Tree View
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('database-client-explorer', treeProvider)
  );

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
    vscode.commands.registerCommand('dbClient.refreshTree', () => {
      treeProvider.refresh();
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

  // Query Folder Commands (➕ Add, 🔗 Bind, Rename, Delete)
  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.addQueryFile', async (node?: QueryGroupNode) => {
      if (!node) return;
      const fileName = await vscode.window.showInputBox({
        prompt: t('Enter query file name', 'Введите имя файла запроса'),
        value: 'query_1.sql',
      });
      if (fileName) {
        const filePath = await QueryFileStorage.createQueryFile(context, node.connectionConfig.id, fileName, node.dbName);
        treeProvider.refresh();
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(doc);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.bindQueryFolder', async (node?: QueryGroupNode) => {
      if (!node) return;
      const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: t('Select Query Folder', 'Выбрать папку с запросами'),
      });
      if (folderUri && folderUri[0]) {
        await QueryFileStorage.setBoundFolder(context, node.connectionConfig.id, folderUri[0].fsPath, node.dbName);
        treeProvider.refresh();
        vscode.window.showInformationMessage(t(`Linked query folder: ${folderUri[0].fsPath}`, `Привязана папка с запросами: ${folderUri[0].fsPath}`));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.renameQueryFile', async (node?: QueryFileNode) => {
      if (!node) return;
      const newName = await vscode.window.showInputBox({
        prompt: t('Enter new file name', 'Введите новое имя файла'),
        value: node.fileName,
      });
      if (newName && newName !== node.fileName) {
        QueryFileStorage.renameQueryFile(node.filePath, newName);
        treeProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.deleteQueryFile', async (node?: QueryFileNode) => {
      if (!node) return;
      const confirm = await vscode.window.showWarningMessage(
        t(`Delete query file "${node.fileName}"?`, `Удалить файл запроса "${node.fileName}"?`),
        { modal: true },
        t('Delete', 'Удалить')
      );
      if (confirm === t('Delete', 'Удалить')) {
        QueryFileStorage.deleteQueryFile(node.filePath);
        treeProvider.refresh();
      }
    })
  );

  // Object Template Creation Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.createTable', async (node?: TableGroupNode) => {
      const template = `-- Create Table Template\nCREATE TABLE \`new_table\` (\n  \`id\` BIGINT NOT NULL AUTO_INCREMENT,\n  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (\`id\`)\n);`;
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: template });
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.createView', async (node?: ViewGroupNode) => {
      const template = `-- Create View Template\nCREATE VIEW \`new_view\` AS\nSELECT * FROM \`tableName\`;`;
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: template });
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.createFunction', async (node?: FunctionGroupNode) => {
      const template = `-- Create Function Template\nDELIMITER //\nCREATE FUNCTION \`new_function\` (param1 INT)\nRETURNS INT\nDETERMINISTIC\nBEGIN\n  RETURN param1 * 2;\nEND //\nDELIMITER ;`;
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: template });
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.createProcedure', async (node?: ProcedureGroupNode) => {
      const template = `-- Create Procedure Template\nDELIMITER //\nCREATE PROCEDURE \`new_procedure\` (IN param1 INT)\nBEGIN\n  SELECT * FROM \`tableName\` WHERE \`id\` = param1;\nEND //\nDELIMITER ;`;
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: template });
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.createTrigger', async (node?: TriggerGroupNode) => {
      const template = `-- Create Trigger Template\nCREATE TRIGGER \`new_trigger\`\nBEFORE INSERT ON \`tableName\`\nFOR EACH ROW\nBEGIN\n  -- Trigger logic\nEND;`;
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: template });
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.queryConsole', async (node: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        const sshPass = (node as ConnectionNode).sshPassword;
        TableWebviewProvider.openQueryConsole(config, pass, sshPass);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.dumpDatabase', async (node: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        const sshPass = (node as ConnectionNode).sshPassword;
        await DatabaseDumpService.dumpDatabase(config, pass, sshPass);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.importSql', async (node: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        const sshPass = (node as ConnectionNode).sshPassword;
        await DatabaseDumpService.importSqlFile(config, pass, sshPass);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.openErd', async (node?: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        const sshPass = (node as ConnectionNode).sshPassword;
        await ErdWebviewProvider.show(config, pass, sshPass);
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
        const config = (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        TableWebviewProvider.openQueryConsole(config, pass);
      } else {
        const sqlComment = t('-- Enter your SQL query below\nSELECT 1;', '-- Введите ваш SQL-запрос ниже\nSELECT 1;');
        const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sqlComment });
        await vscode.window.showTextDocument(doc);
      }
    })
  );

  // Initialize Status Bar Health Monitor
  StatusBarHealthMonitor.getInstance().init(context, storageService);

  // Feature Commands (1-7)
  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.schemaDiff', async (node?: ConnectionNode | DatabaseNode) => {
      const config = node ? (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config : undefined;
      await SchemaDiffWebviewProvider.show(context, storageService, config);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.queryBuilder', async (node?: ConnectionNode | DatabaseNode) => {
      if (node) {
        const config = (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config;
        const pass = (node as ConnectionNode).password;
        const sshPass = (node as ConnectionNode).sshPassword;
        await QueryBuilderWebviewProvider.show(config, pass, sshPass);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.explainQuery', async (node?: ConnectionNode | DatabaseNode) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const sql = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
      if (!sql.trim()) return;

      let config = node ? (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config : undefined;
      let pass = node ? (node as ConnectionNode).password : undefined;
      let sshPass = node ? (node as ConnectionNode).sshPassword : undefined;

      if (!config) {
        const connections = storageService.getConnections();
        if (connections.length > 0) {
          config = connections[0];
          pass = await storageService.getPassword(config.id);
          sshPass = await storageService.getSshPassword(config.id);
        }
      }
      if (config) {
        await ExplainWebviewProvider.show(config, sql, pass, sshPass);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.openRedisEditor', async (node: ConnectionNode) => {
      if (node) {
        await RedisWebviewProvider.show(node.config, node.password, node.sshPassword);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.compareData', async (node: TableNode) => {
      if (node && node.table) {
        await DataSyncWebviewProvider.show(context, storageService, node.connectionConfig, node.table.name);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.aiAssistant', async (node?: ConnectionNode | DatabaseNode) => {
      const config = node ? (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config : undefined;
      const pass = node ? (node as ConnectionNode).password : undefined;
      const sshPass = node ? (node as ConnectionNode).sshPassword : undefined;
      await AiSqlAssistantWebviewProvider.show(config, pass, sshPass);
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
  StatusBarHealthMonitor.getInstance().dispose();
  DriverManager.getInstance().disconnectAll();
}
