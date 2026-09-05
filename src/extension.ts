import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionStorageService } from './storage/ConnectionStorage.js';
import { ConnectionConfig } from './model/ConnectionConfig.js';
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
import { QueryHistoryStorage } from './storage/QueryHistoryStorage.js';
import { ConnectWebviewProvider } from './webview/ConnectWebviewProvider.js';
import { TableWebviewProvider } from './webview/TableWebviewProvider.js';
import { TableDesignWebviewProvider } from './webview/TableDesignWebviewProvider.js';
import { ErdWebviewProvider } from './webview/ErdWebviewProvider.js';
import { ProcessListWebviewProvider } from './webview/ProcessListWebviewProvider.js';
import { DatabaseDumpService } from './dump/DatabaseDumpService.js';
import { MockDataGenerator } from './mock/MockDataGenerator.js';
import { DriverManager } from './drivers/DriverManager.js';
import { ConnectionState } from './drivers/ConnectionState.js';
import { ScriptNode } from './tree/ScriptNode.js';
import { SchemaDiffWebviewProvider } from './webview/SchemaDiffWebviewProvider.js';
import { QueryBuilderWebviewProvider } from './webview/QueryBuilderWebviewProvider.js';
import { ExplainWebviewProvider } from './webview/ExplainWebviewProvider.js';
import { RedisWebviewProvider } from './webview/RedisWebviewProvider.js';
import { DataSyncWebviewProvider } from './webview/DataSyncWebviewProvider.js';
import { AiSqlAssistantWebviewProvider } from './webview/AiSqlAssistantWebviewProvider.js';
import { StatusBarHealthMonitor } from './status/StatusBarHealthMonitor.js';
import { MermaidService } from './diagram/MermaidService.js';
import { ImportService } from './import/ImportService.js';
import { SqlScriptRunner } from './script/SqlScriptRunner.js';
import { resolveQueryParameters } from './sql/QueryParameterPrompt.js';
import { AiService } from './ai/AiService.js';
import {
  buildKnnQuery,
  buildKnnQueryForRow,
  declaredDimensions,
  isVectorColumn,
  parseVector,
  VectorMetric,
} from './sql/VectorQuery.js';
import { formatLiteral } from './sql/QueryParameters.js';
import { formatTableRef } from './sql/RowWriter.js';
import { SchemaNode } from './tree/SchemaNode.js';
import { TableInfo } from './model/QueryTypes.js';
import { SchemaMetadataCache } from './provider/SchemaMetadataCache.js';
import { SqlCompletionProvider } from './provider/SqlCompletionProvider.js';
import { SqlHoverProvider } from './provider/SqlHoverProvider.js';
import { IconHelper } from './util/IconHelper.js';
import { t } from './util/i18n.js';

export function activate(context: vscode.ExtensionContext) {
  IconHelper.setExtensionPath(context.extensionPath);

  const storageService = new ConnectionStorageService(context);
  const historyStorage = QueryHistoryStorage.init(context);
  SchemaMetadataCache.getInstance().init(storageService);
  SchemaMetadataCache.getInstance().refreshAll().catch(() => {});
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
    vscode.commands.registerCommand('dbClient.cloneConnection', async (node?: ConnectionNode) => {
      let targetId: string | undefined;
      let targetName: string | undefined;

      if (node && node.config) {
        targetId = node.config.id;
        targetName = node.config.name;
      } else {
        const connections = storageService.getConnections();
        if (connections.length === 0) {
          vscode.window.showInformationMessage(t('No connections to clone.', 'Нет подключений для клонирования.'));
          return;
        }
        const picked = await vscode.window.showQuickPick(
          connections.map((c) => ({
            label: c.name,
            description: `${c.type} (${c.host || c.dbPath || 'local'})`,
            connectionId: c.id,
          })),
          { title: t('Select Connection to Clone', 'Выберите подключение для клонирования') }
        );
        if (!picked) {
          return;
        }
        targetId = picked.connectionId;
        targetName = picked.label;
      }

      if (!targetId) {
        return;
      }

      try {
        const cloned = await storageService.cloneConnection(targetId);
        if (cloned) {
          treeProvider.refresh();
          const editAction = t('Edit', 'Редактировать');
          const msg = t(`Cloned connection "${targetName}" as "${cloned.name}".`, `Подключение "${targetName}" скопировано как "${cloned.name}".`);
          const choice = await vscode.window.showInformationMessage(msg, editAction);
          if (choice === editAction) {
            const password = await storageService.getPassword(cloned.id);
            const sshPassword = await storageService.getSshPassword(cloned.id);
            ConnectWebviewProvider.show(
              context,
              storageService,
              () => {
                treeProvider.refresh();
              },
              cloned,
              password,
              sshPassword
            );
          }
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(
          t(`Failed to clone connection: ${err.message}`, `Не удалось клонировать подключение: ${err.message}`)
        );
      }
    })
  );


  const reconnectById = async (connectionId: string): Promise<boolean> => {
    const config = storageService.getConnections().find((c) => c.id === connectionId);
    if (!config) {
      return false;
    }
    const pass = await storageService.getPassword(config.id);
    const sshPass = await storageService.getSshPassword(config.id);
    const node = new ConnectionNode(config, context, pass, sshPass);
    const ok = await node.reconnect();
    treeProvider.refresh();
    return ok;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.reconnectConnection', async (target: ConnectionNode | string) => {
      // Invoked from the tree context menu (node), or from the "Reconnect" link
      // in the tooltip / notification / data grid (connection id).
      if (typeof target === 'string') {
        return reconnectById(target);
      }
      if (target && target instanceof ConnectionNode) {
        const ok = await target.reconnect();
        treeProvider.refresh();
        return ok;
      }
      return false;
    })
  );

  // Keep the tree indicator in step with real connection health, and offer a
  // one-click retry the moment a connection drops.
  let lostNoticeShownFor: string | null = null;
  context.subscriptions.push(
    ConnectionState.getInstance().onDidChange(async (change) => {
      treeProvider.refresh();

      if (change.info.status !== 'lost') {
        if (change.connectionId === lostNoticeShownFor) {
          lostNoticeShownFor = null;
        }
        return;
      }

      // One notification per outage, not one per failed query.
      if (lostNoticeShownFor === change.connectionId) {
        return;
      }
      lostNoticeShownFor = change.connectionId;

      const config = storageService.getConnections().find((c) => c.id === change.connectionId);
      const name = config ? config.name : change.connectionId;
      const reconnectLabel = t('Reconnect', 'Переподключиться');
      const choice = await vscode.window.showWarningMessage(
        t(`Connection to "${name}" was lost: ${change.info.errorMessage || 'the database closed the connection'}`,
          `Соединение с "${name}" потеряно: ${change.info.errorMessage || 'база данных закрыла соединение'}`),
        reconnectLabel
      );
      if (choice === reconnectLabel) {
        await reconnectById(change.connectionId);
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
    vscode.commands.registerCommand('dbClient.goToTable', async () => {
      const connections = storageService.getConnections();
      if (connections.length === 0) {
        vscode.window.showInformationMessage(t('No connections configured.', 'Нет настроенных подключений.'));
        return;
      }

      const items: vscode.QuickPickItem[] = [];

      for (const profile of connections) {
        try {
          const pass = await storageService.getPassword(profile.id);
          const sshPass = await storageService.getSshPassword(profile.id);
          const driver = await DriverManager.getInstance().getDriver(profile, pass, sshPass);

          let databases: string[];
          try {
            databases = await driver.getDatabases();
          } catch {
            databases = [];
          }
          if (databases.length === 0) {
            databases = [profile.database || 'default'];
          }

          for (const db of databases) {
            try {
              const schemaName = profile.schema || 'public';
              const getTablesPromise = profile.type === 'Elasticsearch' || profile.type === 'Redis'
                ? driver.getTables()
                : driver.getTables(db, schemaName);

              const tables = await getTablesPromise;
              for (const tbl of tables) {
                const connLabel = profile.name;
                const desc = `${tbl.type === 'view' ? 'View' : 'Table'} · ${db}${schemaName !== 'public' ? ` / ${schemaName}` : ''}`;
                (items as any[]).push({
                  label: tbl.name,
                  description: desc,
                  detail: `${connLabel} › ${desc}`,
                  pick: tbl,
                  connId: profile.id,
                  db: db,
                });
              }
            } catch (err: any) {
              vscode.window.showWarningMessage(`Failed to list tables in ${db}: ${err.message}`);
            }
          }
        } catch (err: any) {
          vscode.window.showWarningMessage(`Failed to connect to ${profile.name}: ${err.message}`);
        }
      }

      if (items.length === 0) {
        vscode.window.showInformationMessage(t('No tables found.', 'Таблицы не найдены.'));
        return;
      }

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: t('Type table name to jump to it…', 'Введите название таблицы для быстрого перехода…'),
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!picked) return;

      const tbl = (picked as any).pick as TableInfo | undefined;
      if (!tbl) return;

      // find the connection that owns this table
      const foundItem = (items as any[]).find((it) => it.pick === tbl);
      if (!foundItem) return;

      const targetConn = connections.find((c) => c.id === foundItem.connId);
      if (!targetConn) return;

      const password = await storageService.getPassword(targetConn.id);
      const sshPassword = await storageService.getSshPassword(targetConn.id);
      const connWithDb = { ...targetConn, database: foundItem.db || targetConn.database };
      const tableNode = new TableNode(tbl, connWithDb, password, sshPassword);

      await vscode.commands.executeCommand('dbClient.openTable', tableNode);
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
    vscode.commands.registerCommand('dbClient.importData', async (node?: TableNode) => {
      if (!node || !(node instanceof TableNode)) {
        return;
      }
      await ImportService.importIntoTable(
        node.table.name,
        node.connectionConfig,
        node.password,
        node.sshPassword,
        node.table.schema
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.queryHistory', async () => {
      const history = historyStorage.getHistory();
      if (history.length === 0) {
        vscode.window.showInformationMessage(t('No queries have been run yet.', 'История запросов пуста.'));
        return;
      }

      const picked = await vscode.window.showQuickPick(
        history.map((h) => ({
          label: h.sql.replace(/\s+/g, ' ').slice(0, 80),
          description: `${h.connectionName}${h.costTimeMs != null ? ` · ${h.costTimeMs}ms` : ''}`,
          detail: new Date(h.timestamp).toLocaleString(),
          item: h,
        })),
        { title: t('Query History', 'История запросов'), matchOnDescription: true, matchOnDetail: true }
      );
      if (!picked) {
        return;
      }

      const openIt = t('Open in editor', 'Открыть в редакторе');
      const copyIt = t('Copy', 'Скопировать');
      const saveIt = t('Save as snippet...', 'Сохранить как сниппет...');
      const choice = await vscode.window.showQuickPick([openIt, copyIt, saveIt], {
        title: picked.item.sql.replace(/\s+/g, ' ').slice(0, 60),
      });

      if (choice === copyIt) {
        await vscode.env.clipboard.writeText(picked.item.sql);
      } else if (choice === saveIt) {
        const title = await vscode.window.showInputBox({ prompt: t('Snippet name', 'Название сниппета') });
        if (title) {
          await historyStorage.addSnippet(title, picked.item.sql);
          vscode.window.showInformationMessage(t(`Saved snippet "${title}".`, `Сниппет "${title}" сохранён.`));
        }
      } else if (choice === openIt) {
        const doc = await vscode.workspace.openTextDocument({ content: picked.item.sql, language: 'sql' });
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.querySnippets', async () => {
      const snippets = historyStorage.getSnippets();
      if (snippets.length === 0) {
        vscode.window.showInformationMessage(
          t('No saved snippets yet. Save one from the query history.', 'Сниппетов нет. Сохраните запрос из истории.')
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        snippets.map((sn) => ({
          label: sn.title,
          description: sn.sql.replace(/\s+/g, ' ').slice(0, 70),
          item: sn,
        })),
        { title: t('Saved Snippets', 'Сохранённые сниппеты'), matchOnDescription: true }
      );
      if (!picked) {
        return;
      }
      const doc = await vscode.workspace.openTextDocument({ content: picked.item.sql, language: 'sql' });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.generateMermaid', async (node?: ConnectionNode | DatabaseNode | SchemaNode) => {
      if (!node) {
        return;
      }
      const config = (node as DatabaseNode).connectionConfig || (node as ConnectionNode).config;
      const pass = (node as any).password;
      const sshPass = (node as any).sshPassword;
      const schemaName = (node as SchemaNode).schemaName || config.schema;
      await MermaidService.generate(config, pass, sshPass, schemaName);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.runQueryFile', async (node?: QueryFileNode) => {
      if (!node) {
        return;
      }
      // The query group owns the connection the file belongs to.
      const group = node.parent as QueryGroupNode | undefined;
      if (!group || !group.connectionConfig) {
        vscode.window.showErrorMessage(t('This script is not linked to a connection.', 'Скрипт не связан с подключением.'));
        return;
      }
      const config = group.dbName ? { ...group.connectionConfig, database: group.dbName } : group.connectionConfig;
      const pass = await storageService.getPassword(config.id);
      const sshPass = await storageService.getSshPassword(config.id);
      await SqlScriptRunner.runFile(node.filePath, config, pass, sshPass);
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
    vscode.commands.registerCommand('dbClient.vectorSearch', async (node?: TableNode) => {
      if (!node || !(node instanceof TableNode)) return;

      const config = node.connectionConfig;
      const driver = await DriverManager.getInstance().getDriver(config, node.password, node.sshPassword);
      const columns = await driver.getColumns(node.table.name, config.database, node.table.schema);
      const vectorColumns = columns.filter((c) => isVectorColumn(c));

      if (vectorColumns.length === 0) {
        vscode.window.showInformationMessage(
          t(
            `"${node.table.name}" has no pgvector columns.`,
            `В таблице "${node.table.name}" нет колонок pgvector.`
          )
        );
        return;
      }

      let vectorColumn = vectorColumns[0];
      if (vectorColumns.length > 1) {
        const picked = await vscode.window.showQuickPick(
          vectorColumns.map((c) => ({
            label: `$(symbol-array) ${c.name}`,
            description: c.type,
            column: c,
          })),
          { placeHolder: t('Select the embedding column', 'Выберите колонку с эмбеддингом') }
        );
        if (!picked) return;
        vectorColumn = picked.column;
      }

      const byRow = t('Similar to an existing row', 'Похожие на существующую строку');
      const byVector = t('Nearest to a pasted embedding', 'Ближайшие к вставленному эмбеддингу');
      const mode = await vscode.window.showQuickPick([byRow, byVector], {
        placeHolder: t('Vector similarity search', 'Поиск по векторному сходству'),
      });
      if (!mode) return;

      const metricPick = await vscode.window.showQuickPick(
        [
          { label: t('Cosine distance', 'Косинусное расстояние'), description: '<=>', metric: 'cosine' as VectorMetric },
          { label: t('Euclidean (L2)', 'Евклидово (L2)'), description: '<->', metric: 'l2' as VectorMetric },
          { label: t('Inner product', 'Скалярное произведение'), description: '<#>', metric: 'inner_product' as VectorMetric },
        ],
        { placeHolder: t('Distance metric', 'Метрика расстояния') }
      );
      if (!metricPick) return;

      const limitInput = await vscode.window.showInputBox({
        title: t('Number of neighbours', 'Количество соседей'),
        value: '10',
        validateInput: (v) => (/^\d+$/.test(v.trim()) && Number(v) > 0 ? undefined : t('Enter a positive integer.', 'Введите целое положительное число.')),
      });
      if (limitInput === undefined) return;

      const tableRef = formatTableRef(config.type, node.table.name, node.table.schema, config.database);
      let sql: string;

      if (mode === byRow) {
        const keyColumn = columns.find((c) => c.isPrimaryKey) || columns[0];
        if (!keyColumn) return;
        const keyValue = await vscode.window.showInputBox({
          title: t(`Anchor row: value of ${keyColumn.name}`, `Опорная строка: значение ${keyColumn.name}`),
          prompt: t('The row whose neighbours you want to find', 'Строка, для которой ищутся ближайшие соседи'),
          ignoreFocusOut: true,
        });
        if (keyValue === undefined || !keyValue.trim()) return;

        sql = buildKnnQueryForRow({
          tableRef,
          vectorColumn: vectorColumn.name,
          keyColumn: keyColumn.name,
          keyLiteral: formatLiteral(keyValue),
          metric: metricPick.metric,
          limit: Number(limitInput),
        });
      } else {
        const declared = declaredDimensions(vectorColumn);
        const pasted = await vscode.window.showInputBox({
          title: t('Reference embedding', 'Эталонный эмбеддинг'),
          prompt: declared
            ? t(`Paste ${declared} comma-separated numbers, e.g. [0.1, 0.2, ...]`, `Вставьте ${declared} чисел через запятую, например [0.1, 0.2, ...]`)
            : t('Paste the embedding, e.g. [0.1, 0.2, 0.3]', 'Вставьте эмбеддинг, например [0.1, 0.2, 0.3]'),
          ignoreFocusOut: true,
          validateInput: (v) => {
            const parsed = parseVector(v);
            if (!parsed) return t('Not a valid embedding.', 'Некорректный эмбеддинг.');
            if (declared && parsed.length !== declared) {
              return t(
                `Expected ${declared} dimensions, got ${parsed.length}.`,
                `Ожидается размерность ${declared}, получено ${parsed.length}.`
              );
            }
            return undefined;
          },
        });
        if (pasted === undefined) return;
        const reference = parseVector(pasted);
        if (!reference) return;

        sql = buildKnnQuery({
          tableRef,
          vectorColumn: vectorColumn.name,
          reference,
          metric: metricPick.metric,
          limit: Number(limitInput),
        });
      }

      await SqlScriptRunner.runScript(
        sql,
        config,
        node.password,
        node.sshPassword,
        `${node.table.name} — ${t('vector search', 'векторный поиск')}`,
        true
      );
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

  const activeEditorConnections = new Map<string, string>();

  const resolveTargetConnection = async (
    editor: vscode.TextEditor,
    explicitNode?: ConnectionNode | DatabaseNode
  ): Promise<{ config: ConnectionConfig; pass?: string; sshPass?: string } | undefined> => {
    let config = explicitNode ? ((explicitNode as DatabaseNode).connectionConfig || (explicitNode as ConnectionNode).config) : undefined;
    let pass = explicitNode ? (explicitNode as ConnectionNode).password : undefined;
    let sshPass = explicitNode ? (explicitNode as ConnectionNode).sshPassword : undefined;

    if (config) {
      if (!pass) pass = await storageService.getPassword(config.id);
      if (!sshPass) sshPass = await storageService.getSshPassword(config.id);
      return { config, pass, sshPass };
    }

    const docUri = editor.document.uri.toString();
    const connections = storageService.getConnections();
    if (connections.length === 0) {
      vscode.window.showWarningMessage(
        t('No database connections configured. Please add a connection first.', 'Подключения не найдены. Пожалуйста, сначала добавьте подключение.')
      );
      return undefined;
    }

    const trackedId = activeEditorConnections.get(docUri);
    let target = trackedId ? connections.find((c) => c.id === trackedId) : undefined;

    if (!target) {
      if (connections.length === 1) {
        target = connections[0];
        activeEditorConnections.set(docUri, target.id);
      } else {
        const items = connections.map((c) => ({
          label: `$(database) ${c.name}`,
          description: `${c.type} — ${c.database || c.dbPath || c.host || ''}`,
          connection: c,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: t('Select database connection to execute query on', 'Выберите подключение к БД для выполнения запроса'),
        });
        if (!picked) return undefined;
        target = picked.connection;
        activeEditorConnections.set(docUri, target.id);
      }
    }

    pass = await storageService.getPassword(target.id);
    sshPass = await storageService.getSshPassword(target.id);
    return { config: target, pass, sshPass };
  };

  const getSqlToExecute = (editor: vscode.TextEditor): string => {
    if (!editor.selection.isEmpty) {
      return editor.document.getText(editor.selection).trim();
    }
    const fullText = editor.document.getText();
    const statements = SqlScriptRunner.split(fullText);
    if (statements.length <= 1) {
      return fullText.trim();
    }
    const cursorLine = editor.selection.active.line + 1;
    let target = statements[0];
    for (let i = 0; i < statements.length; i++) {
      const s = statements[i];
      const nextLine = i + 1 < statements.length ? statements[i + 1].line : Infinity;
      if (cursorLine >= s.line && cursorLine < nextLine) {
        target = s;
        break;
      }
    }
    return target.sql.trim();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.runActiveQuery', async (node?: ConnectionNode | DatabaseNode) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const sql = getSqlToExecute(editor);
      if (!sql) {
        vscode.window.showInformationMessage(t('No SQL query to execute.', 'Нет SQL-запроса для выполнения.'));
        return;
      }
      const target = await resolveTargetConnection(editor, node);
      if (!target) return;
      const boundSql = await resolveQueryParameters(sql);
      if (boundSql === undefined) return;
      await SqlScriptRunner.runScript(
        boundSql,
        target.config,
        target.pass,
        target.sshPass,
        path.basename(editor.document.fileName) || 'Query',
        true
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.chooseEditorConnection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const docUri = editor.document.uri.toString();
      const connections = storageService.getConnections();
      if (connections.length === 0) return;
      const items = connections.map((c) => ({
        label: `$(database) ${c.name}`,
        description: `${c.type} — ${c.database || c.dbPath || c.host || ''}`,
        connection: c,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: t('Switch database connection for this editor', 'Сменить подключение к БД для этого редактора'),
      });
      if (picked) {
        activeEditorConnections.set(docUri, picked.connection.id);
        vscode.window.showInformationMessage(
          t(`Connected "${path.basename(editor.document.fileName)}" to ${picked.connection.name}`,
            `Файл "${path.basename(editor.document.fileName)}" привязан к ${picked.connection.name}`)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.explainQuery', async (node?: ConnectionNode | DatabaseNode) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const sql = getSqlToExecute(editor);
      if (!sql) {
        vscode.window.showInformationMessage(t('No SQL query to explain.', 'Нет SQL-запроса для анализа.'));
        return;
      }
      const target = await resolveTargetConnection(editor, node);
      if (!target) return;
      const boundSql = await resolveQueryParameters(sql);
      if (boundSql === undefined) return;
      await ExplainWebviewProvider.show(target.config, boundSql, target.pass, target.sshPass);
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
      const aiApiKey = await storageService.getAiApiKey();
      await AiSqlAssistantWebviewProvider.show(config, pass, sshPass, aiApiKey);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbClient.setAiApiKey', async () => {
      const existing = await storageService.getAiApiKey();
      const entered = await vscode.window.showInputBox({
        title: t('AI Provider API Key', 'API-ключ ИИ-провайдера'),
        prompt: t(
          'OpenAI (sk-...) or Anthropic (sk-ant-...) key. Stored in VS Code Secrets; leave empty to remove.',
          'Ключ OpenAI (sk-...) или Anthropic (sk-ant-...). Хранится в VS Code Secrets; оставьте пустым, чтобы удалить.'
        ),
        value: existing ?? '',
        password: true,
        ignoreFocusOut: true,
      });
      if (entered === undefined) return;
      await storageService.setAiApiKey(entered);
      vscode.window.showInformationMessage(
        entered.trim()
          ? t(
              `AI key saved (${AiService.detectProvider(entered.trim()) === 'anthropic' ? 'Anthropic' : 'OpenAI'}).`,
              `Ключ ИИ сохранён (${AiService.detectProvider(entered.trim()) === 'anthropic' ? 'Anthropic' : 'OpenAI'}).`
            )
          : t('AI key removed.', 'Ключ ИИ удалён.')
      );
    })
  );

  // Register SQL IntelliSense & Hover Documentation
  const completionProvider = new SqlCompletionProvider();
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'sql' },
      completionProvider,
      '.', ' ', '(', ','
    )
  );

  const hoverProvider = new SqlHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'sql' },
      hoverProvider
    )
  );
}

export function deactivate() {
  StatusBarHealthMonitor.getInstance().dispose();
  DriverManager.getInstance().disconnectAll();
}
