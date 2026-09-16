import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian, t } from '../util/i18n.js';
import { ColumnInfo, TableInfo } from '../model/QueryTypes.js';

export class QueryBuilderWebviewProvider {
  public static async show(
    connectionConfig: ConnectionConfig,
    password?: string,
    sshPassword?: string,
    initialDatabase?: string,
    initialSchema?: string,
    initialTable?: string
  ) {
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

      let databases: string[] = [];
      try {
        databases = await driver.getDatabases();
      } catch {}

      let currentDb = initialDatabase || connectionConfig.database || (databases.length > 0 ? databases[0] : '');

      let schemas: string[] = [];
      try {
        schemas = (await driver.getSchemas(currentDb)).filter(
          (s) => !['information_schema', 'pg_catalog', 'pg_toast'].includes(s)
        );
      } catch {}

      let currentSchema = initialSchema || connectionConfig.schema;
      let tables: TableInfo[] = [];

      if (currentSchema && currentSchema !== '__all__') {
        tables = await driver.getTables(currentDb, currentSchema).catch(() => []);
      } else if (currentSchema === '__all__') {
        tables = await driver.getTables(currentDb).catch(() => []);
      } else {
        // Automatically find which schema has tables
        if (schemas.includes('public')) {
          tables = await driver.getTables(currentDb, 'public').catch(() => []);
          if (tables.length > 0) {
            currentSchema = 'public';
          }
        }
        if (tables.length === 0 && schemas.length > 0) {
          for (const s of schemas) {
            if (s === 'public') continue;
            const sTables = await driver.getTables(currentDb, s).catch(() => []);
            if (sTables.length > 0) {
              currentSchema = s;
              tables = sTables;
              break;
            }
          }
        }
        if (tables.length === 0) {
          tables = await driver.getTables(currentDb).catch(() => []);
          if (tables.length > 0 && tables[0].schema) {
            currentSchema = tables[0].schema;
          } else {
            currentSchema = schemas[0] || 'public';
          }
        }
      }

      // Preload columns for tables
      const tableSchemaList: { name: string; schema?: string; columns: ColumnInfo[] }[] = [];
      await Promise.all(
        tables.slice(0, 100).map(async (tbl) => {
          try {
            const cols = await driver.getColumns(tbl.name, currentDb, tbl.schema);
            tableSchemaList.push({ name: tbl.name, schema: tbl.schema, columns: cols });
          } catch {
            tableSchemaList.push({ name: tbl.name, schema: tbl.schema, columns: [] });
          }
        })
      );
      tableSchemaList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      panel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.type) {
          case 'changeDatabase': {
            try {
              currentDb = msg.database;
              let newSchemas: string[] = [];
              try {
                newSchemas = (await driver.getSchemas(currentDb)).filter(
                  (s) => !['information_schema', 'pg_catalog', 'pg_toast'].includes(s)
                );
              } catch {}
              let targetSchema = newSchemas.includes('public') ? 'public' : newSchemas[0] || 'public';
              let newTables = await driver.getTables(currentDb, targetSchema).catch(() => []);
              if (newTables.length === 0 && newSchemas.length > 0) {
                for (const s of newSchemas) {
                  const sTables = await driver.getTables(currentDb, s).catch(() => []);
                  if (sTables.length > 0) {
                    targetSchema = s;
                    newTables = sTables;
                    break;
                  }
                }
              }
              const schemaList: { name: string; schema?: string; columns: ColumnInfo[] }[] = [];
              await Promise.all(
                newTables.slice(0, 100).map(async (tbl) => {
                  try {
                    const cols = await driver.getColumns(tbl.name, currentDb, tbl.schema);
                    schemaList.push({ name: tbl.name, schema: tbl.schema, columns: cols });
                  } catch {
                    schemaList.push({ name: tbl.name, schema: tbl.schema, columns: [] });
                  }
                })
              );
              schemaList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
              panel.webview.postMessage({
                type: 'databaseChanged',
                database: currentDb,
                schemas: newSchemas,
                currentSchema: targetSchema,
                tables: schemaList,
              });
            } catch (err: any) {
              panel.webview.postMessage({ type: 'error', message: err.message });
            }
            break;
          }
          case 'changeSchema': {
            try {
              currentSchema = msg.schema;
              const schemaFilter = currentSchema === '__all__' ? undefined : currentSchema;
              const newTables = await driver.getTables(currentDb, schemaFilter).catch(() => []);
              const schemaList: { name: string; schema?: string; columns: ColumnInfo[] }[] = [];
              await Promise.all(
                newTables.slice(0, 100).map(async (tbl) => {
                  try {
                    const cols = await driver.getColumns(tbl.name, currentDb, tbl.schema);
                    schemaList.push({ name: tbl.name, schema: tbl.schema, columns: cols });
                  } catch {
                    schemaList.push({ name: tbl.name, schema: tbl.schema, columns: [] });
                  }
                })
              );
              schemaList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
              panel.webview.postMessage({
                type: 'schemaChanged',
                schema: currentSchema,
                tables: schemaList,
              });
            } catch (err: any) {
              panel.webview.postMessage({ type: 'error', message: err.message });
            }
            break;
          }
          case 'loadColumns': {
            try {
              const cols = await driver.getColumns(msg.tableName, currentDb, msg.schema);
              panel.webview.postMessage({
                type: 'columnsLoaded',
                tableName: msg.tableName,
                schema: msg.schema,
                columns: cols,
              });
            } catch (err: any) {
              panel.webview.postMessage({
                type: 'error',
                message: `Failed to load columns for ${msg.tableName}: ${err.message}`,
              });
            }
            break;
          }
          case 'runQuery': {
            try {
              const res = await driver.executeQuery(msg.sql);
              panel.webview.postMessage({ type: 'queryResult', result: res });
            } catch (err: any) {
              panel.webview.postMessage({ type: 'error', message: err.message });
            }
            break;
          }
          case 'copySql': {
            if (msg.sql) {
              await vscode.env.clipboard.writeText(msg.sql);
              vscode.window.setStatusBarMessage(
                t('SQL query copied to clipboard!', 'SQL-запрос скопирован в буфер обмена!'),
                3000
              );
            }
            break;
          }
        }
      });

      panel.webview.html = QueryBuilderWebviewProvider.getHtml(
        connectionConfig.name,
        connectionConfig.type,
        databases,
        currentDb,
        schemas,
        currentSchema || 'public',
        tableSchemaList,
        initialTable
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open Query Builder: ${err.message}`);
    }
  }

  private static getHtml(
    connectionName: string,
    dbType: string,
    databases: string[],
    currentDb: string,
    schemas: string[],
    currentSchema: string,
    tables: any[],
    initialTable?: string
  ): string {
    const ru = isRussian();
    const tablesJson = JSON.stringify(tables);
    const schemasJson = JSON.stringify(schemas);
    const databasesJson = JSON.stringify(databases);

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">
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
      width: 270px;
      min-width: 220px;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-header {
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sidebar-title {
      font-size: 13px;
      font-weight: bold;
      margin: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tables-scroll-list {
      flex: 1;
      overflow-y: auto;
      margin-top: 6px;
    }
    .main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 12px;
    }
    .card-title {
      font-size: 13px;
      font-weight: bold;
      margin: 0 0 10px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    select, input, button {
      padding: 6px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-weight: 500;
      border: none;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #fff);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .table-item {
      padding: 6px 8px;
      cursor: pointer;
      border-radius: 4px;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2px;
      user-select: none;
    }
    .table-item:hover { background: rgba(255,255,255,0.08); }
    .table-item.active {
      background: var(--vscode-list-activeSelectionBackground, #04395e);
      color: var(--vscode-list-activeSelectionForeground, #fff);
      font-weight: bold;
    }
    .schema-badge {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      background: rgba(255,255,255,0.1);
      opacity: 0.8;
      font-family: monospace;
    }
    .type-badge {
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px;
      background: rgba(255,255,255,0.08);
      color: #9cdcfe;
      font-family: monospace;
    }
    .col-item {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.05);
      cursor: pointer;
      font-size: 12px;
    }
    .col-item:hover { background: rgba(255,255,255,0.08); }
    .sql-box {
      font-family: monospace;
      font-size: 13px;
      background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e);
      padding: 12px;
      border-radius: 4px;
      color: #61afef;
      white-space: pre-wrap;
      overflow-x: auto;
      border: 1px solid var(--vscode-panel-border, #333);
      line-height: 1.4;
    }
    .item-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      margin: 3px 4px 3px 0;
    }
    .remove-btn {
      cursor: pointer;
      color: #f87171;
      font-weight: bold;
      padding: 0 3px;
    }
    .remove-btn:hover { color: #ef4444; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 10px; border: 1px solid var(--vscode-panel-border, #333); text-align: left; }
    th { background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e); font-weight: bold; }
    tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
    #errorBox { display: none; background: #7f1d1d; color: #fca5a5; padding: 10px 14px; border-radius: 4px; margin-bottom: 12px; font-size: 13px; }
    .filter-input { width: 100%; box-sizing: border-box; }
    .empty-hint { font-size: 12px; opacity: 0.6; padding: 10px; text-align: center; }
  </style>
</head>
<body>
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
    <h2 style="margin:0; font-size:16px;">🛠️ ${ru ? 'Визуальный Конструктор Запросов' : 'Visual Query Builder'}: <span style="opacity:0.8;">${connectionName}</span></h2>
    <div style="font-size:12px; opacity:0.7;">${dbType}${currentDb ? ' • ' + currentDb : ''}</div>
  </div>

  <div id="errorBox"></div>

  <div class="layout">
    <div class="sidebar">
      <div class="sidebar-header">
        ${databases.length > 1 ? `
        <div>
          <label style="font-size:11px; font-weight:bold; opacity:0.8; margin-bottom:3px; display:block;">${ru ? 'База данных' : 'Database'}:</label>
          <select id="dbSelect" style="width:100%;">
            ${databases.map((db) => `<option value="${db}" ${db === currentDb ? 'selected' : ''}>${db}</option>`).join('')}
          </select>
        </div>` : ''}

        ${schemas.length > 0 ? `
        <div>
          <label style="font-size:11px; font-weight:bold; opacity:0.8; margin-bottom:3px; display:block;">${ru ? 'Схема (Schema)' : 'Schema'}:</label>
          <select id="schemaSelect" style="width:100%;">
            <option value="__all__">${ru ? '★ Все схемы' : '★ All Schemas'}</option>
            ${schemas.map((s) => `<option value="${s}" ${s === currentSchema ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>` : ''}

        <div>
          <input type="text" id="tableSearch" class="filter-input" placeholder="${ru ? '🔍 Поиск таблиц...' : '🔍 Search tables...'}">
        </div>
      </div>

      <div class="sidebar-title">
        <span>📁 ${ru ? 'Таблицы' : 'Tables'} (<span id="tableCount">${tables.length}</span>)</span>
      </div>

      <div class="tables-scroll-list" id="tablesContainer"></div>
    </div>

    <div class="main-area">
      <!-- 1. Table & Columns -->
      <div class="card">
        <div class="card-title">
          <span>1. ${ru ? 'Выбранная Таблица & Колонки (SELECT)' : 'Selected Table & Columns (SELECT)'}</span>
          <div style="display:flex; gap:6px;">
            <button class="secondary" style="padding:2px 8px; font-size:11px;" onclick="selectAllColumns(true)">✓ ${ru ? 'Все' : 'All'}</button>
            <button class="secondary" style="padding:2px 8px; font-size:11px;" onclick="selectAllColumns(false)">✗ ${ru ? 'Снять' : 'None'}</button>
          </div>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <label><b>Table:</b></label>
          <select id="mainTableSelect" style="min-width:240px;"></select>
        </div>
        <div id="columnsCheckboxList" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;"></div>
      </div>

      <!-- 2. Joins -->
      <div class="card">
        <div class="card-title">2. ${ru ? 'Соединения (JOIN)' : 'Joins (JOIN)'}</div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <select id="joinType">
            <option value="INNER JOIN">INNER JOIN</option>
            <option value="LEFT JOIN">LEFT JOIN</option>
            <option value="RIGHT JOIN">RIGHT JOIN</option>
            <option value="FULL JOIN">FULL JOIN</option>
            <option value="CROSS JOIN">CROSS JOIN</option>
          </select>
          <select id="joinTableSelect" style="min-width:180px;"></select>
          <span>ON</span>
          <select id="joinCol1"></select>
          <span>=</span>
          <select id="joinCol2"></select>
          <button id="addJoinBtn">➕ ${ru ? 'Добавить JOIN' : 'Add Join'}</button>
        </div>
        <div id="joinsList" style="margin-top:8px;"></div>
      </div>

      <!-- 3. Conditions & Sorting -->
      <div class="card">
        <div class="card-title">3. ${ru ? 'Условия & Сортировка (WHERE / ORDER BY)' : 'Conditions & Sorting (WHERE / ORDER BY)'}</div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <select id="whereCol"></select>
          <select id="whereOp">
            <option value="=">=</option>
            <option value="!=">!=</option>
            <option value=">">&gt;</option>
            <option value="<">&lt;</option>
            <option value=">=">&gt;=</option>
            <option value="<=">&lt;=</option>
            <option value="LIKE">LIKE</option>
            <option value="ILIKE">ILIKE</option>
            <option value="IS NULL">IS NULL</option>
            <option value="IS NOT NULL">IS NOT NULL</option>
            <option value="IN">IN (...)</option>
          </select>
          <input type="text" id="whereVal" placeholder="${ru ? 'Значение' : 'Value'}" style="width:140px;">
          <button id="addWhereBtn">➕ ${ru ? 'Добавить WHERE' : 'Add Where'}</button>

          <span style="border-left:1px solid rgba(255,255,255,0.15); height:20px; margin:0 4px;"></span>

          <select id="orderCol"></select>
          <select id="orderDir">
            <option value="ASC">ASC</option>
            <option value="DESC">DESC</option>
          </select>
          <button id="addOrderBtn" class="secondary">➕ ${ru ? 'Сортировка' : 'Add Order'}</button>

          <span style="border-left:1px solid rgba(255,255,255,0.15); height:20px; margin:0 4px;"></span>

          <label style="font-size:12px;">Limit:
            <input type="number" id="limitInput" value="50" min="1" max="10000" style="width:65px; margin-left:4px;">
          </label>
        </div>
        <div id="whereList" style="margin-top:8px;"></div>
        <div id="orderList" style="margin-top:4px;"></div>
      </div>

      <!-- 4. Generated SQL -->
      <div class="card">
        <div class="card-title">
          <span>⚡ ${ru ? 'Сгенерированный SQL Запрос' : 'Generated SQL Query'}</span>
          <div style="display:flex; gap:8px;">
            <button class="secondary" id="copySqlBtn">📋 ${ru ? 'Копировать' : 'Copy'}</button>
            <button id="runBtn" style="background:#059669;">▶ ${ru ? 'Выполнить Запрос' : 'Run Query'}</button>
          </div>
        </div>
        <div class="sql-box" id="generatedSql">SELECT * FROM ...;</div>
      </div>

      <!-- 5. Query Result -->
      <div class="card" style="flex:1; overflow:auto; min-height:180px;">
        <div class="card-title">
          <span>📊 ${ru ? 'Результат Выполнения' : 'Query Result'}</span>
          <span id="queryStats" style="font-size:11px; opacity:0.8; font-weight:normal;"></span>
        </div>
        <table id="resultTable"><thead><tr id="resHead"></tr></thead><tbody id="resBody"></tbody></table>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const ru = ${ru};
    const dbType = '${dbType}';

    let currentDb = '${currentDb}';
    let currentSchema = '${currentSchema}';
    let tables = ${tablesJson};
    let schemas = ${schemasJson};
    let databases = ${databasesJson};

    let joins = [];
    let wheres = [];
    let orderBys = [];

    const mainSelect = document.getElementById('mainTableSelect');
    const joinTableSelect = document.getElementById('joinTableSelect');
    const tablesContainer = document.getElementById('tablesContainer');
    const tableCountSpan = document.getElementById('tableCount');
    const dbSelect = document.getElementById('dbSelect');
    const schemaSelect = document.getElementById('schemaSelect');
    const tableSearch = document.getElementById('tableSearch');

    function quoteId(name) {
      if (!name) return '';
      if (dbType === 'MySQL') {
        const Q = String.fromCharCode(96);
        return Q + String(name).split(Q).join(Q + Q) + Q;
      }
      if (dbType === 'SQLServer') {
        return '[' + String(name).replace(/]/g, ']]') + ']';
      }
      return '"' + String(name).replace(/"/g, '""') + '"';
    }

    function formatTable(tblName, tblSchema) {
      if (!tblName) return '';
      const s = tblSchema || (tables.find(t => t.name === tblName)?.schema) || currentSchema;
      if (s && s !== '__all__' && dbType !== 'SQLite' && (dbType !== 'MySQL' || s !== 'public')) {
        return quoteId(s) + '.' + quoteId(tblName);
      }
      return quoteId(tblName);
    }

    function renderTablesList(filterText = '') {
      tablesContainer.innerHTML = '';
      const lower = filterText.toLowerCase().trim();
      const filtered = tables.filter(t => {
        const full = (t.schema ? t.schema + '.' : '') + t.name;
        return full.toLowerCase().includes(lower);
      });

      if (tableCountSpan) {
        tableCountSpan.textContent = filtered.length;
      }

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-hint';
        empty.textContent = ru ? 'Нет таблиц в этой схеме' : 'No tables in this schema';
        tablesContainer.appendChild(empty);
        return;
      }

      filtered.forEach(t => {
        const div = document.createElement('div');
        div.className = 'table-item' + (mainSelect.value === t.name ? ' active' : '');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = '📁 ' + t.name;

        div.appendChild(nameSpan);

        if (t.schema && (currentSchema === '__all__' || t.schema !== currentSchema)) {
          const badge = document.createElement('span');
          badge.className = 'schema-badge';
          badge.textContent = t.schema;
          div.appendChild(badge);
        }

        div.onclick = () => {
          mainSelect.value = t.name;
          onMainTableChange();
        };
        tablesContainer.appendChild(div);
      });
    }

    function populateTableDropdowns() {
      const prevMain = mainSelect.value;
      const prevJoin = joinTableSelect.value;

      mainSelect.innerHTML = '';
      joinTableSelect.innerHTML = '';

      tables.forEach(t => {
        const label = (t.schema && currentSchema === '__all__' ? t.schema + '.' : '') + t.name;
        mainSelect.appendChild(new Option(label, t.name));
        joinTableSelect.appendChild(new Option(label, t.name));
      });

      if (tables.some(t => t.name === prevMain)) {
        mainSelect.value = prevMain;
      } else if (tables.length > 0) {
        mainSelect.value = tables[0].name;
      }

      if (tables.some(t => t.name === prevJoin)) {
        joinTableSelect.value = prevJoin;
      } else if (tables.length > 1) {
        joinTableSelect.value = tables[1].name;
      } else if (tables.length > 0) {
        joinTableSelect.value = tables[0].name;
      }
    }

    function selectAllColumns(check) {
      const checkboxes = document.querySelectorAll('#columnsCheckboxList input[type="checkbox"]');
      checkboxes.forEach(cb => { cb.checked = check; });
      generateSql();
    }

    function updateColumns() {
      const tblObj = tables.find(t => t.name === mainSelect.value);
      const colDiv = document.getElementById('columnsCheckboxList');
      colDiv.innerHTML = '';

      if (tblObj && tblObj.columns && tblObj.columns.length > 0) {
        tblObj.columns.forEach(c => {
          const lbl = document.createElement('label');
          lbl.className = 'col-item';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = c.name;
          cb.checked = true;
          cb.onchange = generateSql;

          const nameSpan = document.createElement('span');
          nameSpan.textContent = c.name + (c.isPrimaryKey ? ' 🔑' : '');

          const typeSpan = document.createElement('span');
          typeSpan.className = 'type-badge';
          typeSpan.textContent = c.type;

          lbl.appendChild(cb);
          lbl.appendChild(nameSpan);
          lbl.appendChild(typeSpan);
          colDiv.appendChild(lbl);
        });
      } else if (tblObj) {
        const loading = document.createElement('div');
        loading.className = 'empty-hint';
        loading.textContent = ru ? 'Загрузка колонок...' : 'Loading columns...';
        colDiv.appendChild(loading);
        vscode.postMessage({ type: 'loadColumns', tableName: tblObj.name, schema: tblObj.schema });
      }

      // Populate Join & Where dropdowns
      const jCol1 = document.getElementById('joinCol1');
      const jCol2 = document.getElementById('joinCol2');
      const wCol = document.getElementById('whereCol');
      const oCol = document.getElementById('orderCol');
      jCol1.innerHTML = ''; jCol2.innerHTML = ''; wCol.innerHTML = ''; oCol.innerHTML = '';

      if (tblObj && tblObj.columns) {
        tblObj.columns.forEach(c => {
          jCol1.appendChild(new Option(tblObj.name + '.' + c.name, c.name));
          wCol.appendChild(new Option(tblObj.name + '.' + c.name, c.name));
          oCol.appendChild(new Option(tblObj.name + '.' + c.name, c.name));
        });
      }

      const joinTblObj = tables.find(t => t.name === joinTableSelect.value);
      if (joinTblObj && joinTblObj.columns) {
        joinTblObj.columns.forEach(c => {
          jCol2.appendChild(new Option(joinTblObj.name + '.' + c.name, c.name));
          wCol.appendChild(new Option(joinTblObj.name + '.' + c.name, c.name));
          oCol.appendChild(new Option(joinTblObj.name + '.' + c.name, c.name));
        });
      }
    }

    function onMainTableChange() {
      updateColumns();
      renderTablesList(tableSearch ? tableSearch.value : '');
      generateSql();
    }

    function generateSql() {
      const tbl = mainSelect.value;
      if (!tbl) {
        document.getElementById('generatedSql').innerText = '-- ' + (ru ? 'Нет выбранной таблицы' : 'No table selected');
        return '';
      }
      const tblObj = tables.find(t => t.name === tbl);
      const tblSchema = tblObj ? tblObj.schema : currentSchema;
      const fullTableRef = formatTable(tbl, tblSchema);

      const checkedBoxes = Array.from(document.querySelectorAll('#columnsCheckboxList input:checked'));
      let colStr = '*';
      if (checkedBoxes.length > 0) {
        colStr = checkedBoxes.map(i => quoteId(tbl) + '.' + quoteId(i.value)).join(', ');
      }

      const limitInput = document.getElementById('limitInput');
      const limitVal = parseInt(limitInput ? limitInput.value : '50', 10);
      const isMssql = dbType === 'SQLServer';

      let sql = 'SELECT ' + (isMssql && limitVal > 0 ? 'TOP ' + limitVal + ' ' : '') + colStr + '\\nFROM ' + fullTableRef;

      joins.forEach(j => {
        const jObj = tables.find(t => t.name === j.table);
        const jSchema = jObj ? jObj.schema : currentSchema;
        const jRef = formatTable(j.table, jSchema);
        sql += '\\n' + j.type + ' ' + jRef + ' ON ' + quoteId(tbl) + '.' + quoteId(j.col1) + ' = ' + quoteId(j.table) + '.' + quoteId(j.col2);
      });

      if (wheres.length > 0) {
        sql += '\\nWHERE ' + wheres.map(w => {
          const tablePrefix = w.table ? quoteId(w.table) + '.' : quoteId(tbl) + '.';
          if (w.op === 'IS NULL' || w.op === 'IS NOT NULL') {
            return tablePrefix + quoteId(w.col) + ' ' + w.op;
          }
          if (w.op === 'IN') {
            return tablePrefix + quoteId(w.col) + ' IN (' + w.val + ')';
          }
          const escapedVal = String(w.val).replace(/'/g, "''");
          return tablePrefix + quoteId(w.col) + ' ' + w.op + ' \\'' + escapedVal + '\\'';
        }).join(' AND ');
      }

      if (orderBys.length > 0) {
        sql += '\\nORDER BY ' + orderBys.map(o => {
          const tablePrefix = o.table ? quoteId(o.table) + '.' : quoteId(tbl) + '.';
          return tablePrefix + quoteId(o.col) + ' ' + o.dir;
        }).join(', ');
      }

      if (!isMssql && limitVal > 0) {
        sql += '\\nLIMIT ' + limitVal + ';';
      } else {
        sql += ';';
      }

      document.getElementById('generatedSql').innerText = sql;
      return sql;
    }

    if (dbSelect) {
      dbSelect.onchange = () => {
        vscode.postMessage({ type: 'changeDatabase', database: dbSelect.value });
      };
    }

    if (schemaSelect) {
      schemaSelect.onchange = () => {
        vscode.postMessage({ type: 'changeSchema', schema: schemaSelect.value });
      };
    }

    if (tableSearch) {
      tableSearch.oninput = () => {
        renderTablesList(tableSearch.value);
      };
    }

    mainSelect.onchange = onMainTableChange;

    joinTableSelect.onchange = () => {
      const joinTblObj = tables.find(t => t.name === joinTableSelect.value);
      if (joinTblObj && (!joinTblObj.columns || joinTblObj.columns.length === 0)) {
        vscode.postMessage({ type: 'loadColumns', tableName: joinTblObj.name, schema: joinTblObj.schema });
      } else {
        updateColumns();
      }
    };

    document.getElementById('limitInput').onchange = generateSql;

    document.getElementById('addJoinBtn').onclick = () => {
      const type = document.getElementById('joinType').value;
      const table = document.getElementById('joinTableSelect').value;
      const col1 = document.getElementById('joinCol1').value;
      const col2 = document.getElementById('joinCol2').value;
      if (!table || !col1 || !col2) return;
      joins.push({ type, table, col1, col2 });
      renderJoinsList();
      generateSql();
    };

    function renderJoinsList() {
      const container = document.getElementById('joinsList');
      container.innerHTML = '';
      joins.forEach((j, idx) => {
        const pill = document.createElement('div');
        pill.className = 'item-pill';
        pill.textContent = '🔗 ' + j.type + ' ' + j.table + ' ON ' + j.col1 + ' = ' + j.col2;
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => {
          joins.splice(idx, 1);
          renderJoinsList();
          generateSql();
        };
        pill.appendChild(removeBtn);
        container.appendChild(pill);
      });
    }

    document.getElementById('addWhereBtn').onclick = () => {
      const col = document.getElementById('whereCol').value;
      const op = document.getElementById('whereOp').value;
      const val = document.getElementById('whereVal').value;
      if (!col) return;
      wheres.push({ col, op, val });
      renderWhereList();
      generateSql();
    };

    function renderWhereList() {
      const container = document.getElementById('whereList');
      container.innerHTML = '';
      wheres.forEach((w, idx) => {
        const pill = document.createElement('div');
        pill.className = 'item-pill';
        pill.textContent = '🔍 ' + w.col + ' ' + w.op + (w.op.includes('NULL') ? '' : ' ' + w.val);
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => {
          wheres.splice(idx, 1);
          renderWhereList();
          generateSql();
        };
        pill.appendChild(removeBtn);
        container.appendChild(pill);
      });
    }

    document.getElementById('addOrderBtn').onclick = () => {
      const col = document.getElementById('orderCol').value;
      const dir = document.getElementById('orderDir').value;
      if (!col) return;
      orderBys.push({ col, dir });
      renderOrderList();
      generateSql();
    };

    function renderOrderList() {
      const container = document.getElementById('orderList');
      container.innerHTML = '';
      orderBys.forEach((o, idx) => {
        const pill = document.createElement('div');
        pill.className = 'item-pill';
        pill.textContent = '↕ ' + o.col + ' ' + o.dir;
        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '✕';
        removeBtn.onclick = () => {
          orderBys.splice(idx, 1);
          renderOrderList();
          generateSql();
        };
        pill.appendChild(removeBtn);
        container.appendChild(pill);
      });
    }

    document.getElementById('copySqlBtn').onclick = () => {
      const sql = generateSql();
      vscode.postMessage({ type: 'copySql', sql });
    };

    document.getElementById('runBtn').onclick = () => {
      const sql = generateSql();
      if (!sql) return;
      document.getElementById('errorBox').style.display = 'none';
      document.getElementById('queryStats').innerText = ru ? 'Выполнение...' : 'Executing...';
      vscode.postMessage({ type: 'runQuery', sql });
    };

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'databaseChanged') {
        currentDb = msg.database;
        currentSchema = msg.currentSchema;
        tables = msg.tables;
        schemas = msg.schemas;

        if (schemaSelect) {
          schemaSelect.innerHTML = '<option value="__all__">' + (ru ? '★ Все схемы' : '★ All Schemas') + '</option>';
          schemas.forEach(s => {
            schemaSelect.appendChild(new Option(s, s, false, s === currentSchema));
          });
        }

        populateTableDropdowns();
        renderTablesList();
        updateColumns();
        generateSql();
      }

      if (msg.type === 'schemaChanged') {
        currentSchema = msg.schema;
        tables = msg.tables;

        populateTableDropdowns();
        renderTablesList();
        updateColumns();
        generateSql();
      }

      if (msg.type === 'columnsLoaded') {
        const target = tables.find(t => t.name === msg.tableName);
        if (target) {
          target.columns = msg.columns;
        }
        if (mainSelect.value === msg.tableName || joinTableSelect.value === msg.tableName) {
          updateColumns();
          generateSql();
        }
      }

      if (msg.type === 'queryResult') {
        const res = msg.result;
        document.getElementById('errorBox').style.display = 'none';
        document.getElementById('queryStats').innerText =
          (ru ? 'Строк: ' : 'Rows: ') + (res.rows ? res.rows.length : 0) + ' | ' + (ru ? 'Время: ' : 'Time: ') + res.costTimeMs + 'ms';

        const head = document.getElementById('resHead');
        const body = document.getElementById('resBody');
        head.innerHTML = (res.fields || []).map(f => '<th>' + f.name + '</th>').join('');
        body.innerHTML = (res.rows || []).map(r => '<tr>' + (res.fields || []).map(f => '<td>' + (r[f.name] !== null && r[f.name] !== undefined ? r[f.name] : '<i style="opacity:0.5;">NULL</i>') + '</td>').join('') + '</tr>').join('');
      }

      if (msg.type === 'error') {
        const errBox = document.getElementById('errorBox');
        errBox.textContent = msg.message;
        errBox.style.display = 'block';
        document.getElementById('queryStats').innerText = '';
      }
    });

    populateTableDropdowns();
    renderTablesList();
    updateColumns();
    generateSql();
  </script>
</body>
</html>`;
  }
}
