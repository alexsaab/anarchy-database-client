import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
import { BaseDriver } from '../drivers/BaseDriver.js';
import { RowWriter, formatTableRef, quoteId, runBound } from '../sql/RowWriter.js';
import { ConnectionState } from '../drivers/ConnectionState.js';
import { TableNode } from '../tree/TableNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { PageParams, QueryResult } from '../model/QueryTypes.js';
import { ExportService } from '../export/ExportService.js';
import { QueryHistoryStorage } from '../storage/QueryHistoryStorage.js';
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
    const schemaName = tableNode.table.schema || 'public';
    const password = tableNode.password;
    const sshPassword = tableNode.sshPassword;
    const panelKey = `${connectionConfig.id}_${connectionConfig.database || ''}_${schemaName}_${tableName}`;

    const existingPanel = TableWebviewProvider.activePanels.get(panelKey);
    if (existingPanel) {
      try {
        existingPanel.dispose();
      } catch (e) {}
      TableWebviewProvider.activePanels.delete(panelKey);
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

    TableWebviewProvider.activePanels.set(panelKey, panel);
    panel.onDidDispose(() => {
      // Only clear the map entry if it still points at this panel: disposing an
      // old panel fires after a replacement has already been registered.
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
      try {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
        const result = await driver.getTableData(tableName, currentParams, schemaName);
        
        let fields = result.fields || [];
        if (fields.length === 0 && (result.rows || []).length > 0) {
          fields = Object.keys(result.rows[0]).map((k) => ({
            name: k,
            type: 'VARCHAR',
            nullable: true,
          }));
        }

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

        const safeResult: QueryResult = {
          ...result,
          fields,
          rows: sanitizedRows,
        };

        lastResult = safeResult;
        panel.webview.postMessage({
          type: 'renderData',
          tableName,
          result: safeResult,
          params: currentParams,
        });
      } catch (err: any) {
        const connectionLost = ConnectionState.isConnectionError(err);
        if (connectionLost) {
          // The connection-lost notification is raised centrally by
          // ConnectionState; the grid just offers the inline retry.
          ConnectionState.getInstance().markLost(connectionConfig.id, err.message);
        } else {
          vscode.window.showErrorMessage(`Failed to load data for ${tableName}: ${err.message}`);
        }
        panel.webview.postMessage({
          type: 'error',
          message: connectionLost
            ? t(`Connection to "${connectionConfig.name}" was lost: ${err.message}`,
                `Соединение с "${connectionConfig.name}" потеряно: ${err.message}`)
            : err.message,
          connectionLost,
        });
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
            currentParams = { ...currentParams, ...msg.params };
            const size = Number(currentParams.pageSize);
            if (!TableWebviewProvider.PAGE_SIZES.includes(size)) {
              currentParams.pageSize = TableWebviewProvider.lastPageSize;
            } else {
              TableWebviewProvider.lastPageSize = size;
            }
          }
          await loadData();
          break;
        case 'updateCell':
        case 'deleteRow':
        case 'insertRow':
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);

            if (!driver.supportsSqlWrites) {
              vscode.window.showWarningMessage(
                t(
                  `Editing rows is not supported for ${dbType}; this view is read-only.`,
                  `Редактирование строк не поддерживается для ${dbType}; просмотр только для чтения.`
                )
              );
              break;
            }

            const writer = new RowWriter(driver, dbType, tableRef);

            if (msg.type === 'insertRow') {
              const res = await runBound(driver, writer.insert(msg.rowData || {}));
              vscode.window.showInformationMessage(
                t(`Inserted ${res.affectedRows ?? 1} row.`, `Добавлено строк: ${res.affectedRows ?? 1}.`)
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

            const statement =
              msg.type === 'updateCell'
                ? writer.update(msg.columnName, msg.isNull ? null : msg.newValue, rowKey)
                : writer.delete(rowKey);

            const res = await runBound(driver, statement);
            const affected = res.affectedRows ?? 0;

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

    let lastResult: QueryResult | null = null;

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'executeSql':
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
            const res = await driver.executeQuery(msg.sql);
            lastResult = res;
            await QueryHistoryStorage.record(msg.sql, connectionConfig.name, res.costTimeMs);
            panel.webview.postMessage({ type: 'queryResult', result: res });
          } catch (err: any) {
            panel.webview.postMessage({ type: 'error', message: err.message });
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
    <button id="prevBtn">◀</button>
    <span id="pageInfo">1</span>
    <button id="nextBtn">▶</button>

    <span>${text.export}</span>
    <button class="secondary" onclick="exportData('csv')">CSV</button>
    <button class="secondary" onclick="exportData('json')">JSON</button>
    <button class="secondary" onclick="exportData('sql')">SQL</button>
    <button class="secondary" onclick="exportData('xlsx')">Excel</button>

    <div class="info" id="stats">Rows: 0 | Time: 0ms</div>
  </div>

  <div id="errorBox"></div>

  <div class="table-container">
    <table id="dataTable">
      <thead><tr id="tableHead"></tr></thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

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
    let searchTimer = null;
    let currentSearch = '';
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

    document.getElementById('prevBtn').onclick = () => {
      if (currentPage > 1) {
        currentPage--;
        vscode.postMessage({
          type: 'fetchData',
          params: {
            page: currentPage,
            searchTerm: currentSearch || undefined,
            sortField: currentSortField || undefined,
            sortOrder: currentSortOrder || undefined,
          }
        });
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
          sortField: currentSortField || undefined,
          sortOrder: currentSortOrder || undefined,
        }
      });
    };

    document.getElementById('nextBtn').onclick = () => {
      if (currentPage * pageSize < totalCount) {
        currentPage++;
        vscode.postMessage({
          type: 'fetchData',
          params: {
            page: currentPage,
            searchTerm: currentSearch || undefined,
            sortField: currentSortField || undefined,
            sortOrder: currentSortOrder || undefined,
          }
        });
      }
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

      rows.forEach((row, idx) => {
        const tr = document.createElement('tr');

        const tdIdx = document.createElement('td');
        tdIdx.textContent = (currentPage - 1) * pageSize + idx + 1;
        tr.appendChild(tdIdx);

        const rowKey = rowKeyOf(row);

        currentFields.forEach(f => {
          const td = document.createElement('td');
          const val = row[f.name];
          if (val === null || val === undefined) {
            const i = document.createElement('i');
            i.textContent = 'null';
            td.appendChild(i);
          } else {
            td.textContent = String(val);
          }
          if (editable) {
            td.className = 'editable';
            td.onclick = () => {
              const valStr = val === null || val === undefined ? 'null' : String(val);
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
        currentFields = res.fields;
        allRows = res.rows || [];

        if (msg.params) {
          currentSortField = msg.params.sortField || null;
          currentSortOrder = msg.params.sortOrder || null;
        }

        document.getElementById('pageInfo').innerText = currentPage + ' / ' + Math.max(1, Math.ceil(totalCount / pageSize));
        document.getElementById('stats').innerText = '${text.stats}: ' + totalCount + ' | ${text.time}: ' + res.costTimeMs + 'ms';

        const headTr = document.getElementById('tableHead');
        headTr.innerHTML = '';

        const thNum = document.createElement('th');
        thNum.textContent = '#';
        headTr.appendChild(thNum);

        const sortTitlePrefix = '${ru ? 'Нажмите для сортировки по полю' : 'Click to sort by'}';
        res.fields.forEach(f => {
          const th = document.createElement('th');
          th.className = 'sortable';
          let sortIcon = '⬍';
          if (currentSortField === f.name) {
            th.classList.add('sorted');
            sortIcon = currentSortOrder === 'ASC' ? '▲' : '▼';
          }
          th.title = sortTitlePrefix + ' ' + f.name;
          th.innerHTML = f.name + ' <span class="sort-icon">' + sortIcon + '</span>';
          th.onclick = () => toggleSort(f.name);
          headTr.appendChild(th);
        });

        const thAction = document.createElement('th');
        thAction.textContent = 'Action';
        headTr.appendChild(thAction);

        renderRows(allRows);
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

    function run() {
      const sql = document.getElementById('sqlInput').value;
      vscode.postMessage({ type: 'executeSql', sql });
    }

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
        errorBox.style.display = 'block';
        errorBox.innerText = '${text.err} ' + msg.message;
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
