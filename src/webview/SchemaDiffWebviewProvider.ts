import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ConnectionStorageService } from '../storage/ConnectionStorage.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian, t } from '../util/i18n.js';

export class SchemaDiffWebviewProvider {
  public static async show(context: vscode.ExtensionContext, storageService: ConnectionStorageService, initialConfig?: ConnectionConfig) {
    const title = t('Schema Comparison & Migration', 'Сравнение схем и генерация миграций');
    const panel = vscode.window.createWebviewPanel(
      'dbClientSchemaDiff',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const connections = storageService.getConnections();

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'compare') {
        const sourceConn = connections.find((c) => c.id === msg.sourceId);
        const targetConn = connections.find((c) => c.id === msg.targetId);

        if (!sourceConn || !targetConn) {
          panel.webview.postMessage({ type: 'error', message: 'Selected connections not found' });
          return;
        }

        try {
          const sourcePass = await storageService.getPassword(sourceConn.id);
          const sourceSshPass = await storageService.getSshPassword(sourceConn.id);
          const targetPass = await storageService.getPassword(targetConn.id);
          const targetSshPass = await storageService.getSshPassword(targetConn.id);

          const sourceDriver = await DriverManager.getInstance().getDriver(sourceConn, sourcePass, sourceSshPass);
          const targetDriver = await DriverManager.getInstance().getDriver(targetConn, targetPass, targetSshPass);

          const sourceDb = msg.sourceDb || sourceConn.database;
          const targetDb = msg.targetDb || targetConn.database;

          const sourceTables = await sourceDriver.getTables(sourceDb);
          const targetTables = await targetDriver.getTables(targetDb);

          const sourceTableMap = new Map();
          for (const tbl of sourceTables) {
            const cols = await sourceDriver.getColumns(tbl.name, sourceDb, tbl.schema);
            sourceTableMap.set(tbl.name, cols);
          }

          const targetTableMap = new Map();
          for (const tbl of targetTables) {
            const cols = await targetDriver.getColumns(tbl.name, targetDb, tbl.schema);
            targetTableMap.set(tbl.name, cols);
          }

          const diffs: any[] = [];
          let migrationSql = `-- Migration script generated from ${sourceConn.name} (${sourceDb}) to ${targetConn.name} (${targetDb})\n\n`;

          // 1. Tables in Source but missing in Target
          for (const [tblName, cols] of sourceTableMap.entries()) {
            if (!targetTableMap.has(tblName)) {
              diffs.push({
                table: tblName,
                status: 'MISSING_IN_TARGET',
                details: `${cols.length} columns to create`,
              });

              let colDefs = cols.map((c: any) => `  "${c.name}" ${c.type}${c.isPrimaryKey ? ' PRIMARY KEY' : ''}${c.nullable ? '' : ' NOT NULL'}`);
              migrationSql += `CREATE TABLE "${tblName}" (\n${colDefs.join(',\n')}\n);\n\n`;
            } else {
              // Compare columns
              const targetCols = targetTableMap.get(tblName);
              const targetColMap = new Map<string, any>(targetCols.map((c: any) => [c.name, c]));

              const colDiffs: string[] = [];
              for (const sCol of cols) {
                const tCol: any = targetColMap.get(sCol.name);
                if (!tCol) {
                  colDiffs.push(`+ Add column ${sCol.name} (${sCol.type})`);
                  migrationSql += `ALTER TABLE "${tblName}" ADD COLUMN "${sCol.name}" ${sCol.type}${sCol.nullable ? '' : ' NOT NULL'};\n`;
                } else if (sCol.type !== tCol.type) {
                  colDiffs.push(`~ Modify column ${sCol.name}: ${tCol.type} -> ${sCol.type}`);
                  migrationSql += `ALTER TABLE "${tblName}" ALTER COLUMN "${sCol.name}" TYPE ${sCol.type};\n`;
                }
              }

              if (colDiffs.length > 0) {
                diffs.push({
                  table: tblName,
                  status: 'MODIFIED',
                  details: colDiffs.join('; '),
                });
                migrationSql += '\n';
              } else {
                diffs.push({
                  table: tblName,
                  status: 'MATCHED',
                  details: 'Identical schema',
                });
              }
            }
          }

          // 2. Extra tables in Target
          for (const [tblName] of targetTableMap.entries()) {
            if (!sourceTableMap.has(tblName)) {
              diffs.push({
                table: tblName,
                status: 'EXTRA_IN_TARGET',
                details: 'Table exists in Target but missing in Source',
              });
            }
          }

          panel.webview.postMessage({
            type: 'diffResult',
            diffs,
            migrationSql,
          });
        } catch (err: any) {
          panel.webview.postMessage({ type: 'error', message: err.message });
        }
      } else if (msg.type === 'executeMigration') {
        const targetConn = connections.find((c) => c.id === msg.targetId);
        if (!targetConn) return;
        try {
          const pass = await storageService.getPassword(targetConn.id);
          const sshPass = await storageService.getSshPassword(targetConn.id);
          const driver = await DriverManager.getInstance().getDriver(targetConn, pass, sshPass);
          await driver.executeQuery(msg.sql);
          vscode.window.showInformationMessage(t('Migration script executed successfully!', 'Скрипт миграции успешно выполнен!'));
        } catch (err: any) {
          vscode.window.showErrorMessage(`Migration failed: ${err.message}`);
        }
      }
    });

    panel.webview.html = SchemaDiffWebviewProvider.getHtml(connections, initialConfig);
  }

  private static getHtml(connections: ConnectionConfig[], initialConfig?: ConnectionConfig): string {
    const ru = isRussian();
    const connOptions = connections
      .map((c) => `<option value="${c.id}" ${initialConfig?.id === c.id ? 'selected' : ''}>${c.name} (${c.type})</option>`)
      .join('');

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${ru ? 'Сравнение Схем' : 'Schema Diff'}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }
    .toolbar {
      display: flex;
      gap: 15px;
      align-items: center;
      background: var(--vscode-sideBar-background);
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
    }
    select, button, textarea {
      padding: 8px 12px;
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
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 15px;
    }
    .table-list { margin-top: 10px; }
    .diff-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      font-size: 13px;
    }
    .badge {
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
    }
    .badge-missing { background: #b91c1c; color: #fecaca; }
    .badge-modified { background: #d97706; color: #fef3c7; }
    .badge-matched { background: #15803d; color: #dcfce7; }
    .badge-extra { background: #4338ca; color: #e0e7ff; }
    textarea {
      width: 100%;
      height: 250px;
      font-family: monospace;
      font-size: 13px;
      margin-top: 10px;
      box-sizing: border-box;
    }
    #errorBox {
      display: none;
      background: #7f1d1d;
      color: #fca5a5;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
    }
  </style>
</head>
<body>
  <h2>⚖️ ${ru ? 'Сравнение Схем и Миграции' : 'Schema Comparison & Migration'}</h2>

  <div id="errorBox"></div>

  <div class="toolbar">
    <div>
      <label><b>${ru ? 'Источник (Source / Dev):' : 'Source DB:'}</b></label>
      <select id="sourceSelect">${connOptions}</select>
    </div>
    <div style="font-size: 20px;">➔</div>
    <div>
      <label><b>${ru ? 'Цель (Target / Prod):' : 'Target DB:'}</b></label>
      <select id="targetSelect">${connOptions}</select>
    </div>
    <button id="compareBtn">⚡ ${ru ? 'Сравнить Схемы' : 'Compare Schemas'}</button>
  </div>

  <div class="grid">
    <div class="card">
      <h3>📊 ${ru ? 'Различия Схем' : 'Schema Differences'}</h3>
      <div id="diffList" class="table-list"><i>${ru ? 'Выберите базы и нажмите Сравнить' : 'Select databases and click Compare'}</i></div>
    </div>
    <div class="card">
      <h3>📜 ${ru ? 'Скрипт Миграции (DDL SQL)' : 'Migration SQL Script'}</h3>
      <textarea id="sqlCode" readonly placeholder="${ru ? 'Сгенерированный SQL появится здесь' : 'Generated SQL will appear here'}"></textarea>
      <div style="margin-top:10px; display:flex; gap:10px;">
        <button id="copyBtn">📋 ${ru ? 'Копировать SQL' : 'Copy SQL'}</button>
        <button id="execBtn" style="background:#059669;">🚀 ${ru ? 'Применить к Целевой БД' : 'Apply to Target DB'}</button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('compareBtn').onclick = () => {
      const sourceId = document.getElementById('sourceSelect').value;
      const targetId = document.getElementById('targetSelect').value;
      document.getElementById('diffList').innerHTML = '⏳ ${ru ? 'Сравнение...' : 'Comparing...'}';
      vscode.postMessage({ type: 'compare', sourceId, targetId });
    };

    document.getElementById('copyBtn').onclick = () => {
      const sql = document.getElementById('sqlCode').value;
      navigator.clipboard.writeText(sql);
      alert('${ru ? 'SQL скрипт скопирован!' : 'SQL script copied!'}');
    };

    document.getElementById('execBtn').onclick = () => {
      const targetId = document.getElementById('targetSelect').value;
      const sql = document.getElementById('sqlCode').value;
      if (!sql.trim()) return;
      if (confirm('${ru ? 'Вы уверены, что хотите применить этот скрипт миграции к целевой базе?' : 'Are you sure you want to apply this migration script to the target database?'}')) {
        vscode.postMessage({ type: 'executeMigration', targetId, sql });
      }
    };

    window.addEventListener('message', e => {
      const msg = e.data;
      const errorBox = document.getElementById('errorBox');
      if (msg.type === 'error') {
        errorBox.style.display = 'block';
        errorBox.innerText = '❌ Error: ' + msg.message;
        return;
      }
      if (msg.type === 'diffResult') {
        errorBox.style.display = 'none';
        document.getElementById('sqlCode').value = msg.migrationSql;
        const list = document.getElementById('diffList');
        list.innerHTML = msg.diffs.map(d => {
          let badgeClass = 'badge-matched';
          if (d.status === 'MISSING_IN_TARGET') badgeClass = 'badge-missing';
          if (d.status === 'MODIFIED') badgeClass = 'badge-modified';
          if (d.status === 'EXTRA_IN_TARGET') badgeClass = 'badge-extra';
          return \`<div class="diff-item">
            <div><b>📁 \${d.table}</b><div style="font-size:11px; opacity:0.7;">\${d.details}</div></div>
            <span class="badge \${badgeClass}">\${d.status}</span>
          </div>\`;
        }).join('');
      }
    });
  </script>
</body>
</html>`;
  }
}
