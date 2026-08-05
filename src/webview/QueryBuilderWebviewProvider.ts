import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian, t } from '../util/i18n.js';

export class QueryBuilderWebviewProvider {
  public static async show(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string) {
    const title = t(`Visual Query Builder: ${connectionConfig.name}`, `Конструктор Запросов: ${connectionConfig.name}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientQueryBuilder',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    try {
      const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
      const tables = await driver.getTables(connectionConfig.database);

      const tableSchemaList = [];
      for (const tbl of tables.slice(0, 40)) {
        const columns = await driver.getColumns(tbl.name, connectionConfig.database, tbl.schema);
        tableSchemaList.push({ name: tbl.name, schema: tbl.schema, columns });
      }

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === 'runQuery') {
          try {
            const res = await driver.executeQuery(msg.sql);
            panel.webview.postMessage({ type: 'queryResult', result: res });
          } catch (err: any) {
            panel.webview.postMessage({ type: 'error', message: err.message });
          }
        }
      });

      panel.webview.html = QueryBuilderWebviewProvider.getHtml(connectionConfig.name, tableSchemaList);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open Query Builder: ${err.message}`);
    }
  }

  private static getHtml(connectionName: string, tables: any[]): string {
    const ru = isRussian();
    const tablesJson = JSON.stringify(tables);

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${ru ? 'Конструктор Запросов' : 'Visual Query Builder'}: ${connectionName}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
      padding: 15px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
    }
    .layout {
      display: flex;
      flex: 1;
      gap: 15px;
      overflow: hidden;
    }
    .sidebar {
      width: 250px;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 10px;
      overflow-y: auto;
    }
    .main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 15px;
      overflow-y: auto;
    }
    .card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 12px;
    }
    select, input, button {
      padding: 6px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-weight: bold;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .table-item {
      padding: 6px;
      cursor: pointer;
      border-radius: 4px;
      font-size: 13px;
    }
    .table-item:hover { background: rgba(255,255,255,0.08); }
    .sql-box {
      font-family: monospace;
      font-size: 14px;
      background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e);
      padding: 12px;
      border-radius: 4px;
      color: #61afef;
      white-space: pre-wrap;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px; border: 1px solid var(--vscode-panel-border, #333); }
    th { background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e); }
    #errorBox { display: none; background: #7f1d1d; color: #fca5a5; padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <h2>🛠️ ${ru ? 'Визуальный Конструктор Запросов (Visual Query Builder)' : 'Visual Query Builder'}: ${connectionName}</h2>

  <div id="errorBox"></div>

  <div class="layout">
    <div class="sidebar">
      <h4>📁 ${ru ? 'Доступные Таблицы' : 'Available Tables'}</h4>
      <div id="tablesContainer"></div>
    </div>

    <div class="main-area">
      <div class="card">
        <h4>1. ${ru ? 'Выбранная Таблица & Колонки (SELECT)' : 'Selected Table & Columns (SELECT)'}</h4>
        <div style="display:flex; gap:10px; align-items:center;">
          <label><b>Table:</b></label>
          <select id="mainTableSelect"></select>
        </div>
        <div id="columnsCheckboxList" style="display:flex; flex-wrap:wrap; gap:10px; margin-top:10px;"></div>
      </div>

      <div class="card">
        <h4>2. ${ru ? 'Соединения (JOIN)' : 'Joins (JOIN)'}</h4>
        <div style="display:flex; gap:10px; align-items:center;">
          <select id="joinType"><option>INNER JOIN</option><option>LEFT JOIN</option><option>RIGHT JOIN</option></select>
          <select id="joinTableSelect"></select>
          <span>ON</span>
          <select id="joinCol1"></select>
          <span>=</span>
          <select id="joinCol2"></select>
          <button id="addJoinBtn">➕ ${ru ? 'Добавить JOIN' : 'Add Join'}</button>
        </div>
        <div id="joinsList" style="margin-top:10px; font-size:13px; font-family:monospace;"></div>
      </div>

      <div class="card">
        <h4>3. ${ru ? 'Условия & Сортировка (WHERE / ORDER BY)' : 'Conditions & Sorting (WHERE / ORDER BY)'}</h4>
        <div style="display:flex; gap:10px; align-items:center;">
          <select id="whereCol"></select>
          <select id="whereOp"><option>=</option><option>&gt;</option><option>&lt;</option><option>LIKE</option><option>IS NOT NULL</option></select>
          <input type="text" id="whereVal" placeholder="${ru ? 'Значение' : 'Value'}">
          <button id="addWhereBtn">➕ ${ru ? 'Добавить Условие' : 'Add Where'}</button>
        </div>
        <div id="whereList" style="margin-top:10px; font-size:13px; font-family:monospace;"></div>
      </div>

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>⚡ ${ru ? 'Сгенерированный SQL Запрос' : 'Generated SQL Query'}</h4>
          <button id="runBtn" style="background:#059669;">▶ ${ru ? 'Выполнить Запрос' : 'Run Query'}</button>
        </div>
        <div class="sql-box" id="generatedSql">SELECT * FROM ...;</div>
      </div>

      <div class="card" style="flex:1; overflow:auto;">
        <h4>📊 ${ru ? 'Результат Выполнения' : 'Query Result'}</h4>
        <table id="resultTable"><thead><tr id="resHead"></tr></thead><tbody id="resBody"></tbody></table>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const tables = ${tablesJson};

    let selectedTable = tables[0]?.name || '';
    let selectedCols = [];
    let joins = [];
    let wheres = [];

    const mainSelect = document.getElementById('mainTableSelect');
    const joinTableSelect = document.getElementById('joinTableSelect');
    tables.forEach(t => {
      mainSelect.appendChild(new Option(t.name, t.name));
      joinTableSelect.appendChild(new Option(t.name, t.name));
    });

    const tablesContainer = document.getElementById('tablesContainer');
    tables.forEach(t => {
      const div = document.createElement('div');
      div.className = 'table-item';
      div.innerText = '📁 ' + t.name;
      div.onclick = () => { mainSelect.value = t.name; updateState(); };
      tablesContainer.appendChild(div);
    });

    function updateColumns() {
      const tblObj = tables.find(t => t.name === mainSelect.value);
      const colDiv = document.getElementById('columnsCheckboxList');
      colDiv.innerHTML = '';
      selectedCols = [];

      if (tblObj) {
        tblObj.columns.forEach(c => {
          const lbl = document.createElement('label');
          lbl.style.fontSize = '12px';
          lbl.innerHTML = \`<input type="checkbox" value="\${c.name}" checked> \${c.name}\`;
          lbl.querySelector('input').onchange = generateSql;
          colDiv.appendChild(lbl);
        });
      }

      // Populate Join & Where dropdowns
      const jCol1 = document.getElementById('joinCol1');
      const jCol2 = document.getElementById('joinCol2');
      const wCol = document.getElementById('whereCol');
      jCol1.innerHTML = ''; jCol2.innerHTML = ''; wCol.innerHTML = '';

      if (tblObj) {
        tblObj.columns.forEach(c => {
          jCol1.appendChild(new Option(c.name, c.name));
          wCol.appendChild(new Option(c.name, c.name));
        });
      }

      const joinTblObj = tables.find(t => t.name === joinTableSelect.value);
      if (joinTblObj) {
        joinTblObj.columns.forEach(c => {
          jCol2.appendChild(new Option(c.name, c.name));
        });
      }
    }

    function generateSql() {
      const tbl = mainSelect.value;
      const checkedCols = Array.from(document.querySelectorAll('#columnsCheckboxList input:checked')).map(i => i.value);
      const colStr = checkedCols.length > 0 ? checkedCols.map(c => \`\`\`\${c}\`\`\`).join(', ') : '*';

      let sql = \`SELECT \${colStr}\\nFROM \`\${tbl}\`\`;

      joins.forEach(j => {
        sql += \`\\n\${j.type} \`\${j.table}\` ON \`\${tbl}\`.\`\${j.col1}\` = \`\${j.table}\`.\`\${j.col2}\`\`;
      });

      if (wheres.length > 0) {
        sql += '\\nWHERE ' + wheres.join(' AND ');
      }

      sql += '\\nLIMIT 50;';
      document.getElementById('generatedSql').innerText = sql;
      return sql;
    }

    mainSelect.onchange = () => { updateColumns(); generateSql(); };
    joinTableSelect.onchange = () => { updateColumns(); };

    document.getElementById('addJoinBtn').onclick = () => {
      const type = document.getElementById('joinType').value;
      const table = document.getElementById('joinTableSelect').value;
      const col1 = document.getElementById('joinCol1').value;
      const col2 = document.getElementById('joinCol2').value;
      joins.push({ type, table, col1, col2 });
      document.getElementById('joinsList').innerHTML = joins.map(j => \`<div>🔗 \${j.type} \${j.table} ON \${j.col1} = \${j.col2}</div>\`).join('');
      generateSql();
    };

    document.getElementById('addWhereBtn').onclick = () => {
      const col = document.getElementById('whereCol').value;
      const op = document.getElementById('whereOp').value;
      const val = document.getElementById('whereVal').value;
      wheres.push(\`\`\`\${col}\`\` \${op} '\${val}'\`);
      document.getElementById('whereList').innerHTML = wheres.map(w => \`<div>🔍 \${w}</div>\`).join('');
      generateSql();
    };

    document.getElementById('runBtn').onclick = () => {
      const sql = generateSql();
      vscode.postMessage({ type: 'runQuery', sql });
    };

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'queryResult') {
        const res = msg.result;
        const head = document.getElementById('resHead');
        const body = document.getElementById('resBody');
        head.innerHTML = res.fields.map(f => \`<th>\${f.name}</th>\`).join('');
        body.innerHTML = res.rows.map(r => \`<tr>\${res.fields.map(f => \`<td>\${r[f.name]}</td>\`).join('')}</tr>\`).join('');
      }
    });

    updateColumns();
    generateSql();
  </script>
</body>
</html>`;
  }
}
