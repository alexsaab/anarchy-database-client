import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
import { TableNode } from '../tree/TableNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { PageParams, QueryResult } from '../model/QueryTypes.js';
import { ExportService } from '../export/ExportService.js';
import { isRussian, t } from '../util/i18n.js';

export class TableWebviewProvider {
  private static activePanels: Map<string, vscode.WebviewPanel> = new Map();

  private static quoteId(dbType: string, name: string): string {
    if (dbType === 'MySQL') {
      return `\`${name}\``;
    }
    return `"${name}"`;
  }

  private static formatTableRef(dbType: string, tableName: string, schemaName?: string, databaseName?: string): string {
    if (dbType === 'MySQL') {
      return databaseName ? `\`${databaseName}\`.\`${tableName}\`` : `\`${tableName}\``;
    }
    if (dbType === 'SQLite') {
      return `"${tableName}"`;
    }
    const s = schemaName || 'public';
    return `"${s}"."${tableName}"`;
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
      TableWebviewProvider.activePanels.delete(panelKey);
    });

    let currentParams: PageParams = {
      page: 1,
      pageSize: 50,
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
        vscode.window.showErrorMessage(`Failed to load data for ${tableName}: ${err.message}`);
        panel.webview.postMessage({
          type: 'error',
          message: err.message,
        });
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      const dbType = connectionConfig.type;
      const tableRef = TableWebviewProvider.formatTableRef(dbType, tableName, schemaName, connectionConfig.database);

      switch (msg.type) {
        case 'fetchData':
          if (msg.params) {
            currentParams = { ...currentParams, ...msg.params };
          }
          await loadData();
          break;
        case 'updateCell':
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
            const valStr = (msg.newValue === null || msg.isNull) ? 'NULL' : `'${String(msg.newValue).replace(/'/g, "''")}'`;
            const pkCol = TableWebviewProvider.quoteId(dbType, msg.pkColumn || 'id');
            const targetCol = TableWebviewProvider.quoteId(dbType, msg.columnName);
            const pkValStr = typeof msg.pkValue === 'number' ? msg.pkValue : `'${msg.pkValue}'`;

            const updateSql = `UPDATE ${tableRef} SET ${targetCol} = ${valStr} WHERE ${pkCol} = ${pkValStr};`;
            await driver.executeQuery(updateSql);
            vscode.window.showInformationMessage(t('Cell updated successfully!', 'Ячейка успешно обновлена!'));
            await loadData();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Update failed: ${e.message}`);
          }
          break;
        case 'insertRow':
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
            const keys = Object.keys(msg.rowData);
            const colNames = keys.map((k) => TableWebviewProvider.quoteId(dbType, k)).join(', ');
            const valStrings = keys.map((k) => {
              const val = msg.rowData[k];
              if (val === null || val === 'NULL' || val === undefined) return 'NULL';
              return `'${String(val).replace(/'/g, "''")}'`;
            }).join(', ');

            const insertSql = `INSERT INTO ${tableRef} (${colNames}) VALUES (${valStrings});`;
            await driver.executeQuery(insertSql);
            vscode.window.showInformationMessage(t('Row inserted successfully!', 'Новая строка добавлена!'));
            await loadData();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Insert failed: ${e.message}`);
          }
          break;
        case 'deleteRow':
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
            const pkCol = TableWebviewProvider.quoteId(dbType, msg.pkColumn || 'id');
            const pkValStr = typeof msg.pkValue === 'number' ? msg.pkValue : `'${msg.pkValue}'`;

            const deleteSql = `DELETE FROM ${tableRef} WHERE ${pkCol} = ${pkValStr};`;
            await driver.executeQuery(deleteSql);
            vscode.window.showInformationMessage(t('Row deleted successfully!', 'Строка удалена!'));
            await loadData();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Delete failed: ${e.message}`);
          }
          break;
        case 'export':
          if (lastResult) {
            await ExportService.exportData(tableName, lastResult, msg.format);
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

  public static openQueryConsole(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string) {
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

    panel.webview.html = TableWebviewProvider.getConsoleHtml(connectionConfig.name);
  }

  private static getHtml(tableName: string): string {
    const ru = isRussian();
    const text = {
      refresh: ru ? '🔄 Обновить' : '🔄 Refresh',
      addRow: ru ? '➕ Добавить строку' : '➕ Add Row',
      searchPh: ru ? '🔍 Быстрый поиск...' : '🔍 Quick Search...',
      sqlFilterPh: ru ? 'Фильтр WHERE (например, age > 18)' : 'SQL WHERE Filter (e.g. status = 1)',
      applyFilter: ru ? 'Фильтр' : 'Filter',
      page: ru ? 'Стр:' : 'Page:',
      export: ru ? 'Экспорт:' : 'Export:',
      stats: ru ? 'Всего строк' : 'Total rows',
      time: ru ? 'Время выполнения' : 'Query time',
      err: ru ? '❌ Ошибка:' : '❌ Error:',
      save: ru ? 'Сохранить' : 'Save',
      cancel: ru ? 'Отмена' : 'Cancel',
      setNull: ru ? 'Установить NULL' : 'Set as NULL',
    };

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
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
      background: #5a1d1d;
      color: #fca5a5;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 10px;
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

    <label>${text.page}</label>
    <button id="prevBtn">◀</button>
    <span id="pageInfo">1</span>
    <button id="nextBtn">▶</button>

    <span>${text.export}</span>
    <button class="secondary" onclick="exportData('csv')">CSV</button>
    <button class="secondary" onclick="exportData('json')">JSON</button>
    <button class="secondary" onclick="exportData('sql')">SQL</button>

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
    let pageSize = 50;
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
          sortField: currentSortField || undefined,
          sortOrder: currentSortOrder || undefined,
        }
      });
    }

    function exportData(format) {
      vscode.postMessage({ type: 'export', format });
    }

    function openModal(title, bodyHtml, onConfirm) {
      document.getElementById('modalTitle').innerText = title;
      document.getElementById('modalBody').innerHTML = bodyHtml;
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

    document.getElementById('quickSearchInput').oninput = (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = allRows.filter(r => {
        return Object.values(r).some(v => String(v || '').toLowerCase().includes(term));
      });
      renderRows(filtered);
    };

    document.getElementById('addRowBtn').onclick = () => {
      if (currentFields.length === 0) return;

      let fieldsHtml = currentFields.map(f =>
        '<div class="modal-form-group">' +
          '<label>' + f.name + ' (' + f.type + ')</label>' +
          '<div style="display:flex; gap:10px; align-items:center;">' +
            '<input type="text" id="add_col_' + f.name + '" placeholder="Value..." style="flex:1;">' +
            '<label style="font-weight:normal; font-size:11px;"><input type="checkbox" id="add_null_' + f.name + '" onchange="document.getElementById(\'add_col_' + f.name + '\').disabled = this.checked;"> NULL</label>' +
          '</div>' +
        '</div>'
      ).join('');

      openModal('${text.addRow}', fieldsHtml, () => {
        const rowData = {};
        currentFields.forEach(f => {
          const isNullChecked = document.getElementById('add_null_' + f.name).checked;
          const val = document.getElementById('add_col_' + f.name).value;
          if (isNullChecked) {
            rowData[f.name] = null;
          } else if (val !== '') {
            rowData[f.name] = val;
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
            sortField: currentSortField || undefined,
            sortOrder: currentSortOrder || undefined,
          }
        });
      }
    };

    document.getElementById('nextBtn').onclick = () => {
      if (currentPage * pageSize < totalCount) {
        currentPage++;
        vscode.postMessage({
          type: 'fetchData',
          params: {
            page: currentPage,
            sortField: currentSortField || undefined,
            sortOrder: currentSortOrder || undefined,
          }
        });
      }
    };

    function editCell(colName, pkCol, pkVal, currentVal) {
      const isNull = currentVal === 'null';
      const html =
        '<div class="modal-form-group">' +
          '<label>Value for "' + colName + '":</label>' +
          '<textarea id="cellValInput" style="width:100%; height:90px;" ' + (isNull ? 'disabled' : '') + '>' + (isNull ? '' : currentVal) + '</textarea>' +
          '<div style="margin-top:8px;">' +
            '<label style="font-size:12px; font-weight:normal;"><input type="checkbox" id="cellSetNullCheckbox" ' + (isNull ? 'checked' : '') + ' onchange="document.getElementById(\'cellValInput\').disabled = this.checked;"> ${text.setNull}</label>' +
          '</div>' +
        '</div>';

      openModal('${ru ? 'Редактировать ячейку' : 'Edit Cell'}: ' + colName, html, () => {
        const setNull = document.getElementById('cellSetNullCheckbox').checked;
        const newVal = document.getElementById('cellValInput').value;
        vscode.postMessage({ type: 'updateCell', columnName: colName, pkColumn: pkCol, pkValue: pkVal, newValue: setNull ? null : newVal, isNull: setNull });
      });
    }

    function deleteRow(pkCol, pkVal) {
      const html = '<p>${ru ? 'Удалить строку с первичным ключом' : 'Delete row with PK'} <b>' + pkCol + ' = ' + pkVal + '</b>?</p>';
      openModal('${ru ? 'Подтвердите удаление' : 'Confirm Deletion'}', html, () => {
        vscode.postMessage({ type: 'deleteRow', pkColumn: pkCol, pkValue: pkVal });
      });
    }

    function renderRows(rows) {
      const pkField = currentFields.find(f => f.isPrimaryKey) || currentFields[0];
      const body = document.getElementById('tableBody');
      body.innerHTML = '';

      rows.forEach((row, idx) => {
        const tr = document.createElement('tr');

        const tdIdx = document.createElement('td');
        tdIdx.textContent = (currentPage - 1) * pageSize + idx + 1;
        tr.appendChild(tdIdx);

        const pkVal = pkField ? row[pkField.name] : idx;

        currentFields.forEach(f => {
          const td = document.createElement('td');
          td.className = 'editable';
          const val = row[f.name];
          if (val === null || val === undefined) {
            td.innerHTML = '<i>null</i>';
          } else {
            td.textContent = String(val);
          }
          td.onclick = () => {
            const valStr = val === null || val === undefined ? 'null' : String(val);
            editCell(f.name, pkField ? pkField.name : '', pkVal, valStr);
          };
          tr.appendChild(td);
        });

        const tdAction = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = '🗑️';
        delBtn.onclick = () => {
          deleteRow(pkField ? pkField.name : '', pkVal);
        };
        tdAction.appendChild(delBtn);
        tr.appendChild(tdAction);

        body.appendChild(tr);
      });
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      const errorBox = document.getElementById('errorBox');

      if (msg.type === 'error') {
        errorBox.style.display = 'block';
        errorBox.innerText = '${text.err} ' + msg.message;
        return;
      }

      if (msg.type === 'renderData') {
        errorBox.style.display = 'none';
        const res = msg.result;
        totalCount = res.totalCount || 0;
        currentPage = msg.params.page;
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
    vscode.postMessage({ type: 'fetchData', params: { page: 1 } });
  </script>
</body>
</html>`;
  }

  private static getConsoleHtml(connectionName: string): string {
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
  <textarea id="sqlInput" placeholder="${text.ph}">SELECT 1;</textarea>
  <div class="actions">
    <button id="runBtn">${text.run}</button>

    <span style="border-left: 1px solid #555; margin: 0 5px; height: 18px;"></span>

    <span>${text.export}</span>
    <button class="secondary" onclick="exportData('csv')">CSV</button>
    <button class="secondary" onclick="exportData('json')">JSON</button>
    <button class="secondary" onclick="exportData('sql')">SQL</button>

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
