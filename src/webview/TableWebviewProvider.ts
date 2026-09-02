import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
import { BaseDriver } from '../drivers/BaseDriver.js';
import { RowWriter, formatTableRef, quoteId, runBound } from '../sql/RowWriter.js';
import { cursorFrom, keyColumnsFor } from '../sql/Keyset.js';
import { ConnectionState } from '../drivers/ConnectionState.js';
import { TableNode } from '../tree/TableNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { PageParams, QueryResult } from '../model/QueryTypes.js';
import { ExportService } from '../export/ExportService.js';
import { QueryHistoryStorage } from '../storage/QueryHistoryStorage.js';
import { DestructiveQueryGuard } from '../sql/DestructiveQueryGuard.js';
import { isRussian, t } from '../util/i18n.js';

export class TableWebviewProvider {
  private static activePanels: Map<string, vscode.WebviewPanel> = new Map();

  /** Rows per page the user last picked, reused when opening further tables. */
  private static lastPageSize: number = 50;
  private static readonly PAGE_SIZES = [10, 50, 100, 500, 1000];

  private static escapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  public static openTable(tableNode: TableNode) {
    const connectionConfig = tableNode.connectionConfig;
    const tableName = tableNode.table.name;
    const schemaName = tableNode.table.schema || (connectionConfig.type === 'PostgreSQL' ? 'public' : (connectionConfig.database || ''));
    const password = tableNode.password;
    const sshPassword = tableNode.sshPassword;
    const panelKey = `${connectionConfig.id}_${connectionConfig.database || ''}_${schemaName}_${tableName}`;

    const existingPanel = TableWebviewProvider.activePanels.get(panelKey);
    if (existingPanel) {
      existingPanel.reveal(vscode.ViewColumn.One);
      existingPanel.webview.postMessage({ type: 'refresh' });
      return;
    }

    const title = t(`Data: ${tableName}`, `Данные: ${tableName}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientDataGrid',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    let isDisposed = false;
    TableWebviewProvider.activePanels.set(panelKey, panel);
    panel.onDidDispose(() => {
      isDisposed = true;
      if (TableWebviewProvider.activePanels.get(panelKey) === panel) {
        TableWebviewProvider.activePanels.delete(panelKey);
      }
    });

    let currentParams: PageParams = {
      page: 1,
      pageSize: TableWebviewProvider.lastPageSize,
    };

    let lastResult: QueryResult | null = null;

    const loadData = async () => {
      if (isDisposed) return;
      try {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
        const result = await driver.getTableData(tableName, currentParams, schemaName);
        if (isDisposed) return;

        let fields = result.fields ? [...result.fields] : [];
        const existingFieldNames = new Set(fields.map((f) => f.name.toLowerCase()));

        // Sanitize rows for postMessage (handling BigInt, Date, Buffer, objects, etc.)
        const sanitizedRows = (result.rows || []).map((row: any) => {
          if (!row || typeof row !== 'object') return row;
          const sanitized: any = {};
          for (const k of Object.keys(row)) {
            const v = row[k];
            if (typeof v === 'bigint') {
              sanitized[k] = v.toString();
            } else if (v instanceof Date) {
              sanitized[k] = v.toISOString();
            } else if (Buffer.isBuffer(v)) {
              sanitized[k] = v.toString('hex');
            } else if (typeof v === 'object' && v !== null) {
              try {
                sanitized[k] = JSON.stringify(v);
              } catch (e) {
                sanitized[k] = String(v);
              }
            } else {
              sanitized[k] = v;
            }
          }
          return sanitized;
        });

        // Ensure all row keys are represented in fields for document stores
        if (sanitizedRows.length > 0) {
          for (const r of sanitizedRows) {
            for (const k of Object.keys(r)) {
              if (!existingFieldNames.has(k.toLowerCase())) {
                existingFieldNames.add(k.toLowerCase());
                fields.push({
                  name: k,
                  type: 'VARCHAR',
                  nullable: true,
                  isPrimaryKey: k === '_id' || k === 'id',
                });
              }
            }
          }
        }

        if (fields.length === 0 || !fields.some((f) => f.isPrimaryKey)) {
          try {
            const schemaCols = await driver.getColumns(tableName, connectionConfig.database, schemaName);
            if (schemaCols && schemaCols.length > 0) {
              if (fields.length === 0) {
                fields = schemaCols;
              } else {
                const colMap = new Map(schemaCols.map((c) => [c.name.toLowerCase(), c]));
                fields = fields.map((f) => {
                  const schemaCol = colMap.get(f.name.toLowerCase());
                  return schemaCol
                    ? {
                        ...f,
                        isPrimaryKey: schemaCol.isPrimaryKey ?? f.isPrimaryKey,
                        type: f.type || schemaCol.type,
                      }
                    : f;
                });
              }
            }
          } catch (e) {}
        }

        const safeResult: QueryResult = {
          ...result,
          fields,
          rows: sanitizedRows,
          totalCount: typeof result.totalCount === 'number' ? result.totalCount : sanitizedRows.length,
        };

        lastResult = safeResult;
        // Use fire-and-forget postMessage (no await) — the original working
        // code did not await this call. Awaiting can silently fail when the
        // webview iframe hasn't fully loaded its script listener yet.
        if (!isDisposed) {
          panel.webview.postMessage({
            type: 'renderData',
            tableName,
            result: safeResult,
            params: currentParams,
          });
        }
      } catch (err: any) {
        if (isDisposed) return;
        const errMsg = String(err?.message || err || 'Unknown error');
        if (errMsg.includes('Webview is disposed') || errMsg.includes('disposed')) {
          return;
        }
        const connectionLost = ConnectionState.isConnectionError(err);
        if (connectionLost) {
          ConnectionState.getInstance().markLost(connectionConfig.id, errMsg);
        } else {
          vscode.window.showErrorMessage(`Failed to load data for ${tableName}: ${errMsg}`);
        }
        if (!isDisposed) {
          panel.webview.postMessage({
            type: 'error',
            message: connectionLost
              ? t(`Connection to "${connectionConfig.name}" was lost: ${errMsg}`,
                  `Соединение с "${connectionConfig.name}" потеряно: ${errMsg}`)
              : errMsg,
            connectionLost,
          });
        }
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      const dbType = connectionConfig.type;
      const tableRef = formatTableRef(dbType, tableName, schemaName, connectionConfig.database);

      switch (msg.type) {
        case 'reconnect':
          try {
            await DriverManager.getInstance().reconnect(connectionConfig, password, sshPassword);
            vscode.window.showInformationMessage(
              t(`Reconnected to ${connectionConfig.name}.`, `Переподключение к ${connectionConfig.name} выполнено.`)
            );
            await loadData();
          } catch (e: any) {
            panel.webview.postMessage({
              type: 'error',
              message: t(`Reconnect failed: ${e.message}`, `Не удалось переподключиться: ${e.message}`),
              connectionLost: true,
            });
          }
          break;
        case 'fetchData':
          if (msg.params) {
            const { cursor, isLastPage, totalCount, ...rest } = msg.params;
            currentParams = {
              ...currentParams,
              ...rest,
              cursor: undefined,
              isLastPage: Boolean(isLastPage),
              totalCount: typeof totalCount === 'number' ? totalCount : undefined,
            };

            const size = Number(currentParams.pageSize);
            if (!TableWebviewProvider.PAGE_SIZES.includes(size)) {
              currentParams.pageSize = TableWebviewProvider.lastPageSize;
            } else {
              TableWebviewProvider.lastPageSize = size;
            }

            // Turn the boundary row into a key cursor, but only when the table
            // has a total order; otherwise paging falls back to OFFSET.
            if (cursor && cursor.row) {
              try {
                const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
                const columns = await driver.getColumns(tableName, connectionConfig.database, schemaName);
                const keys = keyColumnsFor(columns, currentParams.sortField, currentParams.sortOrder);
                if (keys) {
                  currentParams.cursor = {
                    values: cursorFrom(cursor.row, keys),
                    direction: cursor.direction === 'prev' ? 'prev' : 'next',
                  };
                }
              } catch (e) {
                // A cursor is an optimisation; OFFSET still works without it.
              }
            }
          }
          await loadData();
          break;
        case 'updateCell':
        case 'deleteRow':
        case 'insertRow':
          try {
            if (connectionConfig.readOnly) {
              vscode.window.showErrorMessage(
                t(
                  `Connection "${connectionConfig.name}" is in Read-Only mode. Write operations are blocked.`,
                  `Подключение "${connectionConfig.name}" находится в режиме только для чтения. Запись заблокирована.`
                )
              );
              break;
            }

            if (msg.type === 'deleteRow' && DestructiveQueryGuard.isProduction(connectionConfig)) {
              const deleteAction = t('Delete on Production', 'Удалить на Production');
              const confirm = await vscode.window.showWarningMessage(
                t(
                  `⚠️ Production Guard: Are you sure you want to delete this row in "${tableName}" on "${connectionConfig.name}"?`,
                  `⚠️ Защита Production: Вы уверены, что хотите удалить эту строку в "${tableName}" на "${connectionConfig.name}"?`
                ),
                { modal: true },
                deleteAction
              );
              if (confirm !== deleteAction) {
                break;
              }
            }

            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);

            if (!driver.supportsRowWrites) {
              vscode.window.showWarningMessage(
                t(
                  `Editing rows is not supported for ${dbType}; this view is read-only.`,
                  `Редактирование строк не поддерживается для ${dbType}; просмотр только для чтения.`
                )
              );
              break;
            }

            // SQL stores get bound statements; document stores use their own API.
            const nativeWrites = !driver.supportsSqlWrites;
            const writer = new RowWriter(driver, dbType, tableRef);

            if (msg.type === 'insertRow') {
              const affectedRows = nativeWrites
                ? await driver.insertRowNative(tableName, msg.rowData || {}, schemaName)
                : (await runBound(driver, writer.insert(msg.rowData || {}))).affectedRows ?? 1;
              vscode.window.showInformationMessage(
                t(`Inserted ${affectedRows} row.`, `Добавлено строк: ${affectedRows}.`)
              );
              await loadData();
              break;
            }

            // UPDATE and DELETE must address exactly one row. Without a full
            // primary key the WHERE clause is a guess that can rewrite or
            // delete every matching row, so refuse rather than risk it.
            const rowKey = (msg.rowKey || {}) as Record<string, any>;
            const keyColumns = Object.keys(rowKey);
            if (keyColumns.length === 0) {
              vscode.window.showErrorMessage(
                t(
                  `"${tableName}" has no primary key, so a single row cannot be identified safely. Editing is disabled for this table.`,
                  `У "${tableName}" нет первичного ключа, однозначно определить строку невозможно. Редактирование отключено.`
                )
              );
              break;
            }

            let affected: number;
            if (nativeWrites) {
              affected =
                msg.type === 'updateCell'
                  ? await driver.updateRowNative(
                      tableName,
                      rowKey,
                      msg.columnName,
                      msg.isNull ? null : msg.newValue,
                      schemaName
                    )
                  : await driver.deleteRowNative(tableName, rowKey, schemaName);
            } else {
              const statement =
                msg.type === 'updateCell'
                  ? writer.update(msg.columnName, msg.isNull ? null : msg.newValue, rowKey)
                  : writer.delete(rowKey);
              affected = (await runBound(driver, statement)).affectedRows ?? 0;
            }

            if (affected === 0) {
              vscode.window.showWarningMessage(
                t(
                  'No row matched — it may have been changed or removed by someone else. Refreshing.',
                  'Ни одна строка не найдена — возможно, её изменили или удалили. Обновление.'
                )
              );
            } else if (affected > 1) {
              // The key was supposed to be unique; say so rather than pretending
              // a single-row edit happened.
              vscode.window.showWarningMessage(
                t(
                  `${affected} rows were affected — "${tableName}" has no unique key over ${keyColumns.join(', ')}.`,
                  `Затронуто строк: ${affected} — в "${tableName}" нет уникального ключа по ${keyColumns.join(', ')}.`
                )
              );
            } else {
              vscode.window.showInformationMessage(
                msg.type === 'updateCell'
                  ? t('Cell updated.', 'Ячейка обновлена.')
                  : t('Row deleted.', 'Строка удалена.')
              );
            }
            await loadData();
          } catch (e: any) {
            const verb = msg.type === 'insertRow' ? 'Insert' : msg.type === 'deleteRow' ? 'Delete' : 'Update';
            vscode.window.showErrorMessage(`${verb} failed: ${e.message}`);
          }
          break;
        case 'export':
          if (lastResult) {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
            await ExportService.exportData(tableName, lastResult, msg.format, {
              totalCount: lastResult.totalCount || lastResult.rows.length,
              // Same filter and sort as the grid, so the file matches the view.
              fetchPage: (page, pageSize) =>
                driver.getTableData(tableName, { ...currentParams, page, pageSize }, schemaName),
            });
          } else {
            vscode.window.showWarningMessage(t('No data available to export.', 'Нет данных для экспорта.'));
          }
          break;
      }
    });

    panel.webview.html = TableWebviewProvider.getHtml(tableName);
    setTimeout(() => {
      loadData();
    }, 200);
  }

  public static openQueryConsole(
    connectionConfig: ConnectionConfig,
    password?: string,
    sshPassword?: string,
    options?: { initialSql?: string; initialResult?: QueryResult }
  ) {
    const title = t(`Console: ${connectionConfig.name}`, `Консоль: ${connectionConfig.name}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientQueryConsole',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    let isDisposed = false;
    panel.onDidDispose(() => {
      isDisposed = true;
    });

    let lastResult: QueryResult | null = null;
    let runningQuery: { driver: BaseDriver; queryId: number } | null = null;

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (isDisposed) return;
      switch (msg.type) {
        case 'executeSql':
          try {
            const check = DestructiveQueryGuard.checkQuery(msg.sql, connectionConfig);
            if (check.isReadOnlyViolation) {
              if (!isDisposed) {
                panel.webview.postMessage({
                  type: 'error',
                  message: t('Write operations are forbidden on Read-Only connections.', 'Операции записи запрещены на подключениях только для чтения.'),
                });
              }
              break;
            }

            if (check.isDestructive && DestructiveQueryGuard.isProduction(connectionConfig)) {
              const proceed = t('Execute Anyway', 'Всё равно выполнить');
              const confirm = await vscode.window.showWarningMessage(
                t(
                  `⚠️ Production Guard: ${check.reason} on "${connectionConfig.name}". Are you sure you want to execute?`,
                  `⚠️ Защита Production: ${check.reason} на "${connectionConfig.name}". Вы уверены, что хотите выполнить?`
                ),
                { modal: true },
                proceed
              );
              if (confirm !== proceed) {
                if (!isDisposed) {
                  panel.webview.postMessage({
                    type: 'error',
                    message: t('Execution cancelled by user.', 'Выполнение отменено пользователем.'),
                  });
                }
                break;
              }
            }

            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
            if (isDisposed) break;
            // Track the statement so the Cancel button can stop it server-side.
            const queryId = driver.beginQueryId();
            runningQuery = { driver, queryId };
            if (!isDisposed) {
              panel.webview.postMessage({ type: 'queryStarted', cancellable: driver.supportsCancellation });
            }
            try {
              const res = await driver.executeQuery(msg.sql, queryId);
              if (isDisposed) break;
              lastResult = res;
              await QueryHistoryStorage.record(msg.sql, connectionConfig.name, res.costTimeMs);
              if (!isDisposed) {
                panel.webview.postMessage({ type: 'queryResult', result: res });
              }
            } finally {
              runningQuery = null;
              if (!isDisposed) {
                try {
                  panel.webview.postMessage({ type: 'queryFinished' });
                } catch (e) {}
              }
            }
          } catch (err: any) {
            if (!isDisposed) {
              try {
                panel.webview.postMessage({ type: 'error', message: err.message });
              } catch (e) {}
            }
          }
          break;
        case 'cancelQuery':
          if (runningQuery) {
            const cancelled = await runningQuery.driver.cancelQuery(runningQuery.queryId);
            if (!cancelled) {
              vscode.window.showWarningMessage(
                t('The query could not be cancelled.', 'Не удалось отменить запрос.')
              );
            }
          }
          break;
        case 'export':
          if (lastResult) {
            await ExportService.exportData('query_result', lastResult, msg.format);
          } else {
            vscode.window.showWarningMessage(t('No query result available to export.', 'Нет результатов запроса для экспорта.'));
          }
          break;
      }
    });

    panel.webview.html = TableWebviewProvider.getConsoleHtml(connectionConfig.name, options?.initialSql);

    if (options?.initialResult) {
      lastResult = options.initialResult;
      // The webview needs a tick to attach its message listener.
      setTimeout(() => {
        panel.webview.postMessage({ type: 'queryResult', result: options.initialResult });
      }, 300);
    }
  }

  private static getHtml(tableName: string): string {
    const ru = isRussian();
    const initialPageSize = TableWebviewProvider.lastPageSize;
    const pageSizeOptions = TableWebviewProvider.PAGE_SIZES.map(
      (n) => `<option value="${n}"${n === initialPageSize ? ' selected' : ''}>${n}</option>`
    ).join('');
    const text = {
      refresh: ru ? '🔄 Обновить' : '🔄 Refresh',
      addRow: ru ? '➕ Добавить строку' : '➕ Add Row',
      searchPh: ru ? '🔍 Быстрый поиск...' : '🔍 Quick Search...',
      sqlFilterPh: ru ? 'Фильтр WHERE (например, age > 18)' : 'SQL WHERE Filter (e.g. status = 1)',
      applyFilter: ru ? 'Фильтр' : 'Filter',
      page: ru ? 'Стр:' : 'Page:',
      export: ru ? 'Экспорт:' : 'Export:',
      stats: ru ? 'Всего строк' : 'Total rows',
      rowsPerPage: ru ? 'Строк:' : 'Rows:',
      time: ru ? 'Время выполнения' : 'Query time',
      err: ru ? '❌ Ошибка:' : '❌ Error:',
      save: ru ? 'Сохранить' : 'Save',
      cancel: ru ? 'Отмена' : 'Cancel',
      setNull: ru ? 'Установить NULL' : 'Set as NULL',
      reconnect: ru ? '🔄 Переподключиться' : '🔄 Reconnect',
      reconnecting: ru ? 'Переподключение...' : 'Reconnecting...',
      readOnlyHint: ru
        ? 'Нет первичного ключа — редактирование недоступно'
        : 'No primary key — editing is disabled for this table',
      chartView: ru ? '📊 График' : '📊 Chart',
      gridView: ru ? '📋 Таблица' : '📋 Table',
      copyAs: ru ? '📋 Скопировать как...' : '📋 Copy As...',
      firstPage: ru ? 'Первая страница (Home)' : 'First Page (Home)',
      prevPage: ru ? 'Предыдущая страница (PageUp)' : 'Previous Page (PageUp)',
      nextPage: ru ? 'Следующая страница (PageDown)' : 'Next Page (PageDown)',
      lastPage: ru ? 'Последняя страница (End)' : 'Last Page (End)',
      jumpToPage: ru ? 'Перейти к странице (Enter)' : 'Jump to page (Enter)',
    };

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">
  <title>${ru ? 'Данные' : 'Data'}: ${tableName}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
      padding: 10px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: var(--vscode-sideBar-background);
      border-radius: 4px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    input, select, button, textarea {
      padding: 6px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
      box-sizing: border-box;
    }
    button {
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      font-weight: bold;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.danger {
      background: #dc2626;
      color: white;
      padding: 2px 6px;
      font-size: 11px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .toolbar input[type="number"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 13px;
      box-sizing: border-box;
      -moz-appearance: textfield;
    }
    .toolbar input[type="number"]::-webkit-outer-spin-button,
    .toolbar input[type="number"]::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .table-container {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      border-right: 1px solid var(--vscode-panel-border, #333);
      white-space: nowrap;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--vscode-editorHeader-noTabsBackground, #252526);
      font-weight: 600;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s;
    }
    th.sortable:hover {
      background: var(--vscode-list-hoverBackground, #37373d);
    }
    .sort-icon {
      font-size: 11px;
      margin-left: 4px;
      opacity: 0.6;
    }
    th.sorted .sort-icon {
      opacity: 1;
      color: var(--vscode-textLink-activeForeground, #3794ff);
    }
    td.editable:hover {
      background-color: var(--vscode-list-hoverBackground, rgba(255,255,255,0.1));
      cursor: pointer;
    }
    .info {
      margin-left: auto;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    #errorBox {
      display: none;
      align-items: center;
      gap: 12px;
      background: #5a1d1d;
      color: #fca5a5;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 10px;
    }
    #errorBox button {
      background: #dc2626;
      color: #fff;
      white-space: nowrap;
    }
    #errorBox button:disabled {
      opacity: 0.6;
      cursor: default;
    }

    /* Modal Overlay */
    #modalOverlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.75);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal-content {
      background: var(--vscode-sideBar-background);
      padding: 24px;
      border-radius: 8px;
      width: 540px;
      max-width: 90vw;
      max-height: 85vh;
      overflow-y: auto;
      overflow-x: hidden;
      box-sizing: border-box;
      border: 1px solid var(--vscode-panel-border, #555);
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    }
    .modal-content input[type="text"],
    .modal-content textarea,
    .modal-content select {
      width: 100% !important;
      box-sizing: border-box !important;
    }
    .modal-form-group {
      margin-bottom: 14px;
    }
    .modal-form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      font-weight: bold;
    }
    .modal-actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      justify-content: flex-end;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="refreshBtn">${text.refresh}</button>
    <button id="addRowBtn" class="secondary">${text.addRow}</button>

    <input type="text" id="quickSearchInput" placeholder="${text.searchPh}" style="width: 150px;">
    <input type="text" id="sqlFilterInput" placeholder="${text.sqlFilterPh}" style="width: 200px;">
    <button id="filterBtn" class="secondary">${text.applyFilter}</button>

    <label>${text.rowsPerPage}</label>
    <select id="pageSizeSelect" title="${text.rowsPerPage}">${pageSizeOptions}</select>

    <label>${text.page}</label>
    <button id="firstBtn" title="${text.firstPage}">⏮</button>
    <button id="prevBtn" title="${text.prevPage}">◀</button>
    <input type="number" id="pageInput" min="1" value="1" title="${text.jumpToPage}" style="width: 58px; text-align: center;">
    <span id="pageTotal">/ 1</span>
    <button id="nextBtn" title="${text.nextPage}">▶</button>
    <button id="lastBtn" title="${text.lastPage}">⏭</button>

    <span>${text.export}</span>
    <button class="secondary" onclick="exportData('csv')">CSV</button>
    <button class="secondary" onclick="exportData('json')">JSON</button>
    <button class="secondary" onclick="exportData('sql')">SQL</button>
    <button class="secondary" onclick="exportData('xlsx')">Excel</button>

    <select id="copyAsSelect" onchange="if (this.value) { copyAs(this.value); this.value = ''; }">
      <option value="">${text.copyAs}</option>
      <option value="markdown">Markdown Table</option>
      <option value="sql">SQL INSERT</option>
      <option value="json">JSON Array</option>
      <option value="ts">TypeScript Interface</option>
    </select>

    <button id="toggleViewBtn" class="secondary" onclick="toggleChartView()">${text.chartView}</button>

    <div class="info" id="stats">Rows: 0 | Time: 0ms</div>
  </div>

  <div id="errorBox"></div>

  <div class="table-container">
    <table id="dataTable">
      <thead><tr id="tableHead"></tr></thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

  <div id="chartContainer" style="display: none; flex: 1; overflow: auto; border: 1px solid var(--vscode-panel-border, #333); border-radius: 4px; padding: 15px; background: var(--vscode-sideBar-background);">
    <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 15px; flex-wrap: wrap;">
      <label><b>X-Axis:</b></label>
      <select id="chartXAxis" onchange="renderChart()"></select>
      <label><b>Y-Axis:</b></label>
      <select id="chartYAxis" onchange="renderChart()"></select>
      <label><b>Type:</b></label>
      <select id="chartType" onchange="renderChart()">
        <option value="bar">Bar Chart</option>
        <option value="line">Line Chart</option>
        <option value="pie">Pie Chart</option>
      </select>
    </div>
    <div id="chartCanvas" style="width: 100%; min-height: 350px; display: flex; align-items: center; justify-content: center;"></div>
  </div>

  <div id="summaryBar" style="padding: 6px 12px; font-size: 12px; background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border, #333); border-radius: 4px; margin-top: 6px; display: flex; gap: 16px; flex-wrap: wrap;"></div>

  <!-- HTML Modal -->
  <div id="modalOverlay">
    <div class="modal-content">
      <h3 id="modalTitle" style="margin-top:0;">Modal</h3>
      <div id="modalBody"></div>
      <div class="modal-actions">
        <button class="secondary" onclick="closeModal()">${text.cancel}</button>
        <button id="modalConfirmBtn">${text.save}</button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentPage = 1;
    let totalCount = 0;
    let pageSize = ${initialPageSize};
    let currentFields = [];
    let allRows = [];
    let currentSortField = null;
    let currentSortOrder = null;
    let currentSearch = '';
    let searchTimer = null;
    let isChartView = false;

    function toggleSort(fieldName) {
      if (currentSortField === fieldName) {
        if (currentSortOrder === 'ASC') {
          currentSortOrder = 'DESC';
        } else if (currentSortOrder === 'DESC') {
          currentSortField = null;
          currentSortOrder = null;
        }
      } else {
        currentSortField = fieldName;
        currentSortOrder = 'ASC';
      }

      vscode.postMessage({
        type: 'fetchData',
        params: {
          page: 1,
          searchTerm: currentSearch || undefined,
          sortField: currentSortField || undefined,
          sortOrder: currentSortOrder || undefined,
        }
      });
    }

    function exportData(format) {
      vscode.postMessage({ type: 'export', format });
    }

    function openModal(title, body, onConfirm) {
      document.getElementById('modalTitle').textContent = title;
      const host = document.getElementById('modalBody');
      host.textContent = '';
      // Only nodes: values from the database must never be parsed as markup.
      host.appendChild(typeof body === 'string' ? document.createTextNode(body) : body);
      document.getElementById('modalOverlay').style.display = 'flex';

      const confirmBtn = document.getElementById('modalConfirmBtn');
      confirmBtn.onclick = () => {
        onConfirm();
        closeModal();
      };
    }

    function closeModal() {
      document.getElementById('modalOverlay').style.display = 'none';
    }

    document.getElementById('refreshBtn').onclick = () => {
      vscode.postMessage({
        type: 'fetchData',
        params: {
          page: currentPage,
          sortField: currentSortField || undefined,
          sortOrder: currentSortOrder || undefined,
        }
      });
    };

    document.getElementById('filterBtn').onclick = () => {
      const filterSql = document.getElementById('sqlFilterInput').value.trim();
      vscode.postMessage({
        type: 'fetchData',
        params: {
          page: 1,
          filterSql,
          sortField: currentSortField || undefined,
          sortOrder: currentSortOrder || undefined,
        }
      });
    };

    // The search runs on the server, so matches on other pages are found too.
    // Typing is debounced to avoid a query per keystroke.
    document.getElementById('quickSearchInput').oninput = (e) => {
      const term = e.target.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentSearch = term;
        currentPage = 1;
        vscode.postMessage({
          type: 'fetchData',
          params: {
            page: 1,
            pageSize,
            searchTerm: term || undefined,
            sortField: currentSortField || undefined,
            sortOrder: currentSortOrder || undefined,
          }
        });
      }, 300);
    };

    document.getElementById('addRowBtn').onclick = () => {
      if (currentFields.length === 0) return;

      const form = document.createElement('div');
      const inputs = {};

      currentFields.forEach(f => {
        const group = document.createElement('div');
        group.className = 'modal-form-group';

        const label = document.createElement('label');
        label.textContent = f.name + ' (' + f.type + ')';
        group.appendChild(label);

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '10px';
        row.style.alignItems = 'center';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Value...';
        input.style.flex = '1';
        row.appendChild(input);

        const nullLabel = document.createElement('label');
        nullLabel.style.fontWeight = 'normal';
        nullLabel.style.fontSize = '11px';
        const nullBox = document.createElement('input');
        nullBox.type = 'checkbox';
        nullBox.onchange = () => { input.disabled = nullBox.checked; };
        nullLabel.appendChild(nullBox);
        nullLabel.appendChild(document.createTextNode(' NULL'));
        row.appendChild(nullLabel);

        group.appendChild(row);
        form.appendChild(group);
        inputs[f.name] = { input, nullBox };
      });

      openModal('${text.addRow}', form, () => {
        const rowData = {};
        currentFields.forEach(f => {
          const { input, nullBox } = inputs[f.name];
          if (nullBox.checked) {
            rowData[f.name] = null;
          } else if (input.value !== '') {
            rowData[f.name] = input.value;
          }
        });
        vscode.postMessage({ type: 'insertRow', rowData });
      });
    };

    function goToPage(targetPage, cursorDirection, isLastPage) {
      const maxPages = Math.max(1, Math.ceil(totalCount / pageSize));
      let page = parseInt(targetPage, 10);
      if (isNaN(page) || page < 1) page = 1;
      if (page > maxPages) page = maxPages;
      if (page === currentPage && !cursorDirection && !isLastPage) {
        const input = document.getElementById('pageInput');
        if (input) input.value = String(currentPage);
        return;
      }
      currentPage = page;
      const input = document.getElementById('pageInput');
      if (input) input.value = String(currentPage);

      let cursor = undefined;
      if (cursorDirection === 'prev' && allRows.length > 0) {
        cursor = { row: allRows[0], direction: 'prev' };
      } else if (cursorDirection === 'next' && allRows.length > 0) {
        cursor = { row: allRows[allRows.length - 1], direction: 'next' };
      }

      vscode.postMessage({
        type: 'fetchData',
        params: {
          page: currentPage,
          pageSize,
          searchTerm: currentSearch || undefined,
          sortField: currentSortField || undefined,
          sortOrder: currentSortOrder || undefined,
          cursor,
          isLastPage: Boolean(isLastPage || (currentPage === maxPages && maxPages > 1)),
          totalCount,
        }
      });
    }

    document.getElementById('firstBtn').onclick = () => {
      goToPage(1);
    };

    document.getElementById('prevBtn').onclick = () => {
      if (currentPage > 1) {
        goToPage(currentPage - 1, 'prev');
      }
    };

    document.getElementById('pageSizeSelect').onchange = (e) => {
      pageSize = parseInt(e.target.value, 10);
      currentPage = 1;
      vscode.postMessage({
        type: 'fetchData',
        params: {
          page: 1,
          pageSize,
          searchTerm: currentSearch || undefined,
          sortField: currentSortField || undefined,
          sortOrder: currentSortOrder || undefined,
          isLastPage: false,
        }
      });
    };

    document.getElementById('nextBtn').onclick = () => {
      const maxPages = Math.max(1, Math.ceil(totalCount / pageSize));
      if (currentPage < maxPages) {
        goToPage(currentPage + 1, 'next');
      }
    };

    document.getElementById('lastBtn').onclick = () => {
      const maxPages = Math.max(1, Math.ceil(totalCount / pageSize));
      goToPage(maxPages, undefined, true);
    };

    const pageInputEl = document.getElementById('pageInput');
    pageInputEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        goToPage(e.target.value);
        e.target.blur();
      }
    };
    pageInputEl.onchange = (e) => {
      goToPage(e.target.value);
    };

    function editCell(colName, rowKey, currentVal) {
      const isNull = currentVal === 'null';

      // Built with DOM APIs, never innerHTML: a cell may contain markup, and
      // this webview can post messages back to the extension.
      const wrap = document.createElement('div');
      wrap.className = 'modal-form-group';

      const label = document.createElement('label');
      label.textContent = '${ru ? 'Значение' : 'Value for'} "' + colName + '":';
      wrap.appendChild(label);

      const textarea = document.createElement('textarea');
      textarea.id = 'cellValInput';
      textarea.style.width = '100%';
      textarea.style.height = '90px';
      textarea.disabled = isNull;
      textarea.value = isNull ? '' : currentVal;
      wrap.appendChild(textarea);

      const nullWrap = document.createElement('div');
      nullWrap.style.marginTop = '8px';
      const nullLabel = document.createElement('label');
      nullLabel.style.fontSize = '12px';
      nullLabel.style.fontWeight = 'normal';
      const nullBox = document.createElement('input');
      nullBox.type = 'checkbox';
      nullBox.id = 'cellSetNullCheckbox';
      nullBox.checked = isNull;
      nullBox.onchange = () => { textarea.disabled = nullBox.checked; };
      nullLabel.appendChild(nullBox);
      nullLabel.appendChild(document.createTextNode(' ${text.setNull}'));
      nullWrap.appendChild(nullLabel);
      wrap.appendChild(nullWrap);

      openModal('${ru ? 'Редактировать ячейку' : 'Edit Cell'}: ' + colName, wrap, () => {
        vscode.postMessage({
          type: 'updateCell',
          columnName: colName,
          rowKey,
          newValue: nullBox.checked ? null : textarea.value,
          isNull: nullBox.checked,
        });
      });
    }

    function deleteRow(rowKey) {
      const p = document.createElement('p');
      p.textContent = '${ru ? 'Удалить строку' : 'Delete row'} ' +
        Object.keys(rowKey).map(k => k + ' = ' + rowKey[k]).join(', ') + '?';
      openModal('${ru ? 'Подтвердите удаление' : 'Confirm Deletion'}', p, () => {
        vscode.postMessage({ type: 'deleteRow', rowKey });
      });
    }

    // Columns that identify one row. Without them the grid stays read-only:
    // a WHERE clause built from a non-unique column can rewrite every match.
    function keyColumns() {
      return currentFields.filter(f => f.isPrimaryKey).map(f => f.name);
    }

    function rowKeyOf(row) {
      const keys = keyColumns();
      if (keys.length === 0) return null;
      const key = {};
      for (const k of keys) key[k] = row[k];
      return key;
    }

    function renderRows(rows) {
      const editable = keyColumns().length > 0;
      const body = document.getElementById('tableBody');
      body.textContent = '';

      if (!rows || rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = Math.max(1, currentFields.length + 2);
        td.style.textAlign = 'center';
        td.style.padding = '30px';
        td.style.opacity = '0.7';
        td.textContent = '${ru ? "Таблица пуста (0 строк)" : "No records found (0 rows)"}';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }

      rows.forEach((row, idx) => {
        const tr = document.createElement('tr');

        const tdIdx = document.createElement('td');
        tdIdx.textContent = (currentPage - 1) * pageSize + idx + 1;
        tr.appendChild(tdIdx);

        const rowKey = rowKeyOf(row);

        currentFields.forEach(f => {
          const td = document.createElement('td');
          let val = row[f.name];
          if (val === undefined && f.name) {
            const matchKey = Object.keys(row).find(k => k.toLowerCase() === f.name.toLowerCase());
            if (matchKey) val = row[matchKey];
          }

          if (val === null || val === undefined) {
            const i = document.createElement('i');
            i.textContent = 'null';
            td.appendChild(i);
          } else {
            td.textContent = typeof val === 'object' ? JSON.stringify(val) : String(val);
          }
          if (editable) {
            td.className = 'editable';
            td.onclick = () => {
              const valStr = val === null || val === undefined ? 'null' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
              editCell(f.name, rowKey, valStr);
            };
          } else {
            td.title = '${text.readOnlyHint}';
          }
          tr.appendChild(td);
        });

        const tdAction = document.createElement('td');
        if (editable) {
          const delBtn = document.createElement('button');
          delBtn.className = 'danger';
          delBtn.textContent = '🗑️';
          delBtn.onclick = () => deleteRow(rowKey);
          tdAction.appendChild(delBtn);
        }
        tr.appendChild(tdAction);

        body.appendChild(tr);
      });
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      const errorBox = document.getElementById('errorBox');

      if (msg.type === 'refresh') {
        vscode.postMessage({
          type: 'fetchData',
          params: {
            page: currentPage,
            sortField: currentSortField || undefined,
            sortOrder: currentSortOrder || undefined,
          }
        });
        return;
      }

      if (msg.type === 'error') {
        errorBox.style.display = 'flex';
        errorBox.textContent = '';

        const label = document.createElement('span');
        label.textContent = '${text.err} ' + msg.message;
        errorBox.appendChild(label);

        if (msg.connectionLost) {
          const btn = document.createElement('button');
          btn.textContent = '${text.reconnect}';
          btn.onclick = () => {
            btn.disabled = true;
            label.textContent = '${text.reconnecting}';
            vscode.postMessage({ type: 'reconnect' });
          };
          errorBox.appendChild(btn);
        }
        return;
      }

      if (msg.type === 'renderData') {
        errorBox.style.display = 'none';
        const res = msg.result;
        totalCount = res.totalCount || 0;
        currentPage = msg.params.page;
        if (msg.params.pageSize) {
          pageSize = msg.params.pageSize;
          document.getElementById('pageSizeSelect').value = String(pageSize);
        }
        currentFields = (res.fields && res.fields.length > 0) ? res.fields : [];
        allRows = res.rows || [];
        if (currentFields.length === 0 && allRows.length > 0) {
          currentFields = Object.keys(allRows[0]).map(k => ({ name: k, type: 'VARCHAR', nullable: true }));
        }

        if (msg.params) {
          currentSortField = msg.params.sortField || null;
          currentSortOrder = msg.params.sortOrder || null;
        }

        const maxPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const pageInput = document.getElementById('pageInput');
        if (pageInput) {
          pageInput.value = String(currentPage);
          pageInput.max = String(maxPages);
        }
        const pageTotal = document.getElementById('pageTotal');
        if (pageTotal) {
          pageTotal.innerText = '/ ' + maxPages;
        }
        const firstBtn = document.getElementById('firstBtn');
        if (firstBtn) firstBtn.disabled = currentPage <= 1;
        const prevBtn = document.getElementById('prevBtn');
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        const nextBtn = document.getElementById('nextBtn');
        if (nextBtn) nextBtn.disabled = currentPage >= maxPages;
        const lastBtn = document.getElementById('lastBtn');
        if (lastBtn) lastBtn.disabled = currentPage >= maxPages;

        document.getElementById('stats').innerText = '${text.stats}: ' + totalCount + ' | ${text.time}: ' + res.costTimeMs + 'ms';

        const headTr = document.getElementById('tableHead');
        headTr.innerHTML = '';

        const thNum = document.createElement('th');
        thNum.textContent = '#';
        headTr.appendChild(thNum);

        const sortTitlePrefix = '${ru ? 'Нажмите для сортировки по полю' : 'Click to sort by'}';
        currentFields.forEach(f => {
          const th = document.createElement('th');
          th.className = 'sortable';
          let sortIcon = '⬍';
          if (currentSortField === f.name) {
            th.classList.add('sorted');
            sortIcon = currentSortOrder === 'ASC' ? '▲' : '▼';
          }
          th.title = (f.type ? f.type + ' — ' : '') + sortTitlePrefix + ' ' + f.name;
          th.textContent = f.name + (f.isPrimaryKey ? ' 🔑' : '') + ' ';
          const iconSpan = document.createElement('span');
          iconSpan.className = 'sort-icon';
          iconSpan.textContent = sortIcon;
          th.appendChild(iconSpan);
          th.onclick = () => toggleSort(f.name);
          headTr.appendChild(th);
        });

        const thAction = document.createElement('th');
        thAction.textContent = 'Action';
        headTr.appendChild(thAction);

        renderRows(allRows);
        updateSummaryBar(allRows);
        if (isChartView) {
          populateChartSelects();
          renderChart();
        }
      }
    });

    function toggleChartView() {
      isChartView = !isChartView;
      const tableContainer = document.querySelector('.table-container');
      const chartContainer = document.getElementById('chartContainer');
      const toggleBtn = document.getElementById('toggleViewBtn');

      if (isChartView) {
        tableContainer.style.display = 'none';
        chartContainer.style.display = 'block';
        toggleBtn.textContent = '${text.gridView}';
        populateChartSelects();
        renderChart();
      } else {
        tableContainer.style.display = 'block';
        chartContainer.style.display = 'none';
        toggleBtn.textContent = '${text.chartView}';
      }
    }

    function populateChartSelects() {
      const xSel = document.getElementById('chartXAxis');
      const ySel = document.getElementById('chartYAxis');
      if (!xSel || !ySel) return;
      const curX = xSel.value;
      const curY = ySel.value;
      xSel.textContent = '';
      ySel.textContent = '';

      currentFields.forEach(f => {
        const optX = document.createElement('option');
        optX.value = f.name;
        optX.textContent = f.name;
        xSel.appendChild(optX);

        const optY = document.createElement('option');
        optY.value = f.name;
        optY.textContent = f.name;
        ySel.appendChild(optY);
      });

      if (curX && currentFields.some(f => f.name === curX)) {
        xSel.value = curX;
      }
      if (curY && currentFields.some(f => f.name === curY)) {
        ySel.value = curY;
      } else {
        const numericCol = currentFields.find(f => {
          const t = (f.type || '').toLowerCase();
          return t.includes('int') || t.includes('float') || t.includes('decimal') || t.includes('numeric') || t.includes('double') || t.includes('real');
        });
        if (numericCol) {
          ySel.value = numericCol.name;
        }
      }
    }

    function renderChart() {
      if (!isChartView) return;
      const canvas = document.getElementById('chartCanvas');
      if (!canvas) return;
      canvas.textContent = '';
      if (!allRows || allRows.length === 0) {
        canvas.textContent = 'No data available to chart.';
        return;
      }

      const xCol = document.getElementById('chartXAxis').value;
      const yCol = document.getElementById('chartYAxis').value;
      const type = document.getElementById('chartType').value;

      if (!xCol || !yCol) return;

      const data = allRows.slice(0, 50).map(r => ({
        label: String(r[xCol] !== null && r[xCol] !== undefined ? r[xCol] : ''),
        value: Number(r[yCol]) || 0
      }));

      const maxVal = Math.max(...data.map(d => d.value), 1);
      const minVal = Math.min(...data.map(d => d.value), 0);
      const range = maxVal - minVal || 1;

      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '380');
      svg.setAttribute('viewBox', '0 0 800 380');
      svg.style.overflow = 'visible';

      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

      if (type === 'bar') {
        const barWidth = Math.max(10, Math.floor(700 / data.length) - 6);
        data.forEach((d, i) => {
          const barHeight = Math.max(2, Math.round(((d.value - minVal) / range) * 280));
          const x = 50 + i * (barWidth + 6);
          const y = 320 - barHeight;

          const rect = document.createElementNS(svgNS, 'rect');
          rect.setAttribute('x', String(x));
          rect.setAttribute('y', String(y));
          rect.setAttribute('width', String(barWidth));
          rect.setAttribute('height', String(barHeight));
          rect.setAttribute('fill', colors[i % colors.length]);
          rect.setAttribute('rx', '3');

          const title = document.createElementNS(svgNS, 'title');
          title.textContent = d.label + ': ' + d.value;
          rect.appendChild(title);
          svg.appendChild(rect);

          if (data.length <= 25) {
            const text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', String(x + barWidth / 2));
            text.setAttribute('y', '340');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', 'var(--vscode-foreground)');
            text.setAttribute('font-size', '10');
            text.textContent = d.label.length > 8 ? d.label.slice(0, 7) + '..' : d.label;
            svg.appendChild(text);
          }
        });
      } else if (type === 'line') {
        const points = data.map((d, i) => {
          const x = 50 + (i / Math.max(data.length - 1, 1)) * 700;
          const y = 320 - Math.round(((d.value - minVal) / range) * 280);
          return x + ',' + y;
        }).join(' ');

        const polyline = document.createElementNS(svgNS, 'polyline');
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', '#3b82f6');
        polyline.setAttribute('stroke-width', '3');
        polyline.setAttribute('points', points);
        svg.appendChild(polyline);

        data.forEach((d, i) => {
          const x = 50 + (i / Math.max(data.length - 1, 1)) * 700;
          const y = 320 - Math.round(((d.value - minVal) / range) * 280);
          const circle = document.createElementNS(svgNS, 'circle');
          circle.setAttribute('cx', String(x));
          circle.setAttribute('cy', String(y));
          circle.setAttribute('r', '4');
          circle.setAttribute('fill', '#60a5fa');
          const title = document.createElementNS(svgNS, 'title');
          title.textContent = d.label + ': ' + d.value;
          circle.appendChild(title);
          svg.appendChild(circle);
        });
      } else if (type === 'pie') {
        const total = data.reduce((acc, d) => acc + Math.max(0, d.value), 0) || 1;
        let startAngle = 0;
        const cx = 400;
        const cy = 180;
        const r = 130;

        data.slice(0, 10).forEach((d, i) => {
          const sliceAngle = (Math.max(0, d.value) / total) * 2 * Math.PI;
          const endAngle = startAngle + sliceAngle;

          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);

          const largeArc = sliceAngle > Math.PI ? 1 : 0;
          const pathData = 'M ' + cx + ' ' + cy + ' L ' + x1 + ' ' + y1 + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 + ' Z';

          const path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', pathData);
          path.setAttribute('fill', colors[i % colors.length]);
          const title = document.createElementNS(svgNS, 'title');
          title.textContent = d.label + ': ' + d.value + ' (' + Math.round((d.value / total) * 100) + '%)';
          path.appendChild(title);
          svg.appendChild(path);

          startAngle = endAngle;
        });
      }

      canvas.appendChild(svg);
    }

    function updateSummaryBar(rows) {
      const summaryBar = document.getElementById('summaryBar');
      if (!summaryBar) return;
      summaryBar.textContent = '';

      const totalSpan = document.createElement('span');
      totalSpan.innerHTML = '📊 <strong>' + '${text.stats}' + ':</strong> ' + (totalCount || rows.length);
      summaryBar.appendChild(totalSpan);

      const numericCols = currentFields.filter(f => {
        const t = (f.type || '').toLowerCase();
        return t.includes('int') || t.includes('float') || t.includes('decimal') || t.includes('numeric') || t.includes('double') || t.includes('real');
      });

      numericCols.slice(0, 3).forEach(f => {
        const vals = rows.map(r => Number(r[f.name])).filter(v => !isNaN(v) && v !== null);
        if (vals.length > 0) {
          const sum = vals.reduce((a, b) => a + b, 0);
          const avg = sum / vals.length;
          const min = Math.min(...vals);
          const max = Math.max(...vals);

          const colSpan = document.createElement('span');
          colSpan.style.borderLeft = '1px solid var(--vscode-panel-border, #444)';
          colSpan.style.paddingLeft = '12px';
          colSpan.textContent = f.name + ': Sum=' + sum.toLocaleString() + ' | Avg=' + avg.toFixed(2) + ' | Min=' + min + ' | Max=' + max;
          summaryBar.appendChild(colSpan);
        }
      });
    }

    function copyAs(format) {
      if (!allRows || allRows.length === 0) {
        alert('${ru ? "Нет данных для копирования" : "No data to copy"}');
        return;
      }
      let text = '';
      if (format === 'markdown') {
        const colNames = currentFields.map(f => f.name);
        text = '| ' + colNames.join(' | ') + ' |\\n| ' + colNames.map(() => '---').join(' | ') + ' |\\n';
        text += allRows.map(r => '| ' + colNames.map(c => (r[c] === null || r[c] === undefined ? 'NULL' : String(r[c]))).join(' | ') + ' |').join('\\n');
      } else if (format === 'sql') {
        const colNames = currentFields.map(f => '"' + f.name + '"').join(', ');
        text = allRows.map(r => {
          const vals = currentFields.map(f => {
            const v = r[f.name];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return String(v);
            return "'" + String(v).replace(/'/g, "''") + "'";
          }).join(', ');
          return 'INSERT INTO "table" (' + colNames + ') VALUES (' + vals + ');';
        }).join('\\n');
      } else if (format === 'json') {
        text = JSON.stringify(allRows, null, 2);
      } else if (format === 'ts') {
        const lines = currentFields.map(f => {
          let t = 'string';
          const type = (f.type || '').toLowerCase();
          if (type.includes('int') || type.includes('float') || type.includes('decimal') || type.includes('numeric')) t = 'number';
          else if (type.includes('bool')) t = 'boolean';
          return '  ' + f.name + (f.nullable ? '?: ' : ': ') + t + ';';
        });
        text = 'export interface RowData {\\n' + lines.join('\\n') + '\\n}';
      }
      navigator.clipboard.writeText(text);
      alert('${ru ? "Скопировано в буфер обмена!" : "Copied to clipboard!"}');
    }

    window.addEventListener('keydown', (e) => {
      const active = document.activeElement;
      const tag = active ? active.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }
      const maxPages = Math.max(1, Math.ceil(totalCount / pageSize));
      if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(maxPages, undefined, true);
      } else if (e.key === 'PageUp') {
        if (currentPage > 1) {
          e.preventDefault();
          goToPage(currentPage - 1, 'prev');
        }
      } else if (e.key === 'PageDown') {
        if (currentPage < maxPages) {
          e.preventDefault();
          goToPage(currentPage + 1, 'next');
        }
      }
    });

    // Automatically trigger initial load when webview is ready
    vscode.postMessage({ type: 'fetchData', params: { page: 1, pageSize } });
  </script>
</body>
</html>`;
  }

  private static getConsoleHtml(connectionName: string, initialSql?: string): string {
    const ru = isRussian();
    const text = {
      title: ru ? '⚡ SQL Консоль Запросов' : '⚡ SQL Query Console',
      ph: ru ? 'Введите SQL-запрос (например, SELECT * FROM users LIMIT 10;)' : 'Enter SQL query here (e.g. SELECT * FROM users LIMIT 10;)',
      run: ru ? '▶ Выполнить (Ctrl+Enter)' : '▶ Run Query (Ctrl+Enter)',
      cancel2: ru ? '■ Отменить' : '■ Cancel',
      running: ru ? 'Выполняется...' : 'Running...',
      export: ru ? 'Экспорт:' : 'Export:',
      affected: ru ? 'Изменено' : 'Affected',
      time: ru ? 'Время' : 'Time',
      err: ru ? '❌ Ошибка:' : '❌ Error:',
    };

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">
  <title>${text.title}: ${connectionName}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
      padding: 10px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
    }
    textarea {
      width: 100%;
      height: 150px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
      padding: 10px;
      font-family: monospace;
      font-size: 14px;
      box-sizing: border-box;
      resize: vertical;
    }
    .actions {
      margin: 10px 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .result-container {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 4px;
      margin-top: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      border-right: 1px solid var(--vscode-panel-border, #333);
    }
    th {
      background: var(--vscode-editorHeader-noTabsBackground, #252526);
    }
    #errorBox {
      display: none;
      background: #5a1d1d;
      color: #fca5a5;
      padding: 10px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h3>${text.title} [${connectionName}]</h3>
  <textarea id="sqlInput" placeholder="${text.ph}">${TableWebviewProvider.escapeHtml(initialSql || 'SELECT 1;')}</textarea>
  <div class="actions">
    <button id="runBtn">${text.run}</button>
    <button id="cancelBtn" class="danger" style="display:none;">${text.cancel2}</button>

    <span style="border-left: 1px solid #555; margin: 0 5px; height: 18px;"></span>

    <span>${text.export}</span>
    <button class="secondary" onclick="exportData('csv')">CSV</button>
    <button class="secondary" onclick="exportData('json')">JSON</button>
    <button class="secondary" onclick="exportData('sql')">SQL</button>
    <button class="secondary" onclick="exportData('xlsx')">Excel</button>

    <span id="costTime" style="margin-left:auto; font-size:12px;"></span>
  </div>

  <div id="errorBox"></div>

  <div class="result-container">
    <table id="resultTable">
      <thead><tr id="resHead"></tr></thead>
      <tbody id="resBody"></tbody>
    </table>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const runBtn = document.getElementById('runBtn');
    const cancelBtn = document.getElementById('cancelBtn');

    function run() {
      const sql = document.getElementById('sqlInput').value;
      vscode.postMessage({ type: 'executeSql', sql });
    }

    cancelBtn.onclick = () => {
      cancelBtn.disabled = true;
      vscode.postMessage({ type: 'cancelQuery' });
    };

    function exportData(format) {
      vscode.postMessage({ type: 'export', format });
    }

    document.getElementById('runBtn').onclick = run;
    document.getElementById('sqlInput').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        run();
      }
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      const errorBox = document.getElementById('errorBox');

      if (msg.type === 'error') {
        runBtn.disabled = false;
        cancelBtn.style.display = 'none';
        errorBox.style.display = 'block';
        errorBox.innerText = '${text.err} ' + msg.message;
        return;
      }

      if (msg.type === 'queryStarted') {
        runBtn.disabled = true;
        document.getElementById('costTime').innerText = '${text.running}';
        if (msg.cancellable) {
          cancelBtn.style.display = '';
          cancelBtn.disabled = false;
        }
        return;
      }

      if (msg.type === 'queryFinished') {
        runBtn.disabled = false;
        cancelBtn.style.display = 'none';
        return;
      }

      if (msg.type === 'queryResult') {
        errorBox.style.display = 'none';
        const res = msg.result;
        document.getElementById('costTime').innerText = \`${text.affected}: \${res.affectedRows} | ${text.time}: \${res.costTimeMs}ms\`;

        const headTr = document.getElementById('resHead');
        headTr.innerHTML = res.fields.map(f => \`<th>\${f.name}</th>\`).join('');

        const body = document.getElementById('resBody');
        body.innerHTML = res.rows.map(r => {
          const cells = res.fields.map(f => \`<td>\${r[f.name] === null ? '<i>null</i>' : String(r[f.name])}</td>\`).join('');
          return \`<tr>\${cells}</tr>\`;
        }).join('');
      }
    });
  </script>
</body>
</html>`;
  }
}
