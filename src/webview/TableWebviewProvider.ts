import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
import { TableNode } from '../tree/TableNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { PageParams, QueryResult } from '../model/QueryTypes.js';
import { ExportService } from '../export/ExportService.js';
import { isRussian, t } from '../util/i18n.js';

export class TableWebviewProvider {
  public static openTable(tableNode: TableNode) {
    const title = t(`Data: ${tableNode.table.name}`, `Данные: ${tableNode.table.name}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientDataGrid',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const connectionConfig = tableNode.connectionConfig;
    const tableName = tableNode.table.name;
    const schemaName = tableNode.table.schema || 'public';
    const password = tableNode.password;
    const sshPassword = tableNode.sshPassword;

    let currentParams: PageParams = {
      page: 1,
      pageSize: 50,
    };

    let lastResult: QueryResult | null = null;

    const loadData = async () => {
      try {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
        const result = await driver.getTableData(tableName, currentParams, schemaName);
        lastResult = result;
        panel.webview.postMessage({
          type: 'renderData',
          tableName,
          result,
          params: currentParams,
        });
      } catch (err: any) {
        panel.webview.postMessage({
          type: 'error',
          message: err.message,
        });
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'fetchData':
          if (msg.params) {
            currentParams = { ...currentParams, ...msg.params };
          }
          await loadData();
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
    loadData();
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
      page: ru ? 'Стр:' : 'Page:',
      export: ru ? 'Экспорт:' : 'Export:',
      stats: ru ? 'Всего строк' : 'Total rows',
      time: ru ? 'Время выполнения' : 'Query time',
      err: ru ? '❌ Ошибка:' : '❌ Error:',
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
      gap: 10px;
      padding: 8px;
      background: var(--vscode-sideBar-background);
      border-radius: 4px;
      margin-bottom: 10px;
    }
    input, select, button {
      padding: 6px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
    }
    button {
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
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
    tr:hover {
      background-color: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05));
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
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="refreshBtn">${text.refresh}</button>
    <label>${text.page}</label>
    <button id="prevBtn">◀</button>
    <span id="pageInfo">1</span>
    <button id="nextBtn">▶</button>

    <span style="border-left: 1px solid #555; margin: 0 5px; height: 18px;"></span>

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

  <script>
    const vscode = acquireVsCodeApi();
    let currentPage = 1;
    let totalCount = 0;
    let pageSize = 50;

    function exportData(format) {
      vscode.postMessage({ type: 'export', format });
    }

    document.getElementById('refreshBtn').onclick = () => {
      vscode.postMessage({ type: 'fetchData', params: { page: currentPage } });
    };

    document.getElementById('prevBtn').onclick = () => {
      if (currentPage > 1) {
        currentPage--;
        vscode.postMessage({ type: 'fetchData', params: { page: currentPage } });
      }
    };

    document.getElementById('nextBtn').onclick = () => {
      if (currentPage * pageSize < totalCount) {
        currentPage++;
        vscode.postMessage({ type: 'fetchData', params: { page: currentPage } });
      }
    };

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

        document.getElementById('pageInfo').innerText = currentPage + ' / ' + Math.max(1, Math.ceil(totalCount / pageSize));
        document.getElementById('stats').innerText = \`${text.stats}: \${totalCount} | ${text.time}: \${res.costTimeMs}ms\`;

        // Render Head
        const headTr = document.getElementById('tableHead');
        headTr.innerHTML = '<th>#</th>' + res.fields.map(f => \`<th>\${f.name}</th>\`).join('');

        // Render Body
        const body = document.getElementById('tableBody');
        body.innerHTML = res.rows.map((row, idx) => {
          const cells = res.fields.map(f => {
            const val = row[f.name];
            return \`<td>\${val === null ? '<i>null</i>' : String(val)}</td>\`;
          }).join('');
          return \`<tr><td>\${(currentPage - 1) * pageSize + idx + 1}</td>\${cells}</tr>\`;
        }).join('');
      }
    });
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

        const body = document.innerHTML = res.rows.map(r => {
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
