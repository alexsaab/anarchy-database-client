import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ConnectionStorageService } from '../storage/ConnectionStorage.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian, t } from '../util/i18n.js';

export class DataSyncWebviewProvider {
  public static async show(context: vscode.ExtensionContext, storageService: ConnectionStorageService, sourceConfig: ConnectionConfig, tableName: string) {
    const title = t(`Data Sync: ${tableName}`, `Синхронизация Данных: ${tableName}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientDataSync',
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
        const targetConn = connections.find((c) => c.id === msg.targetId);
        if (!targetConn) return;

        try {
          const sourcePass = await storageService.getPassword(sourceConfig.id);
          const sourceSshPass = await storageService.getSshPassword(sourceConfig.id);
          const targetPass = await storageService.getPassword(targetConn.id);
          const targetSshPass = await storageService.getSshPassword(targetConn.id);

          const sourceDriver = await DriverManager.getInstance().getDriver(sourceConfig, sourcePass, sourceSshPass);
          const targetDriver = await DriverManager.getInstance().getDriver(targetConn, targetPass, targetSshPass);

          const sourceData = await sourceDriver.getTableData(tableName, { page: 1, pageSize: 200 });
          const targetData = await targetDriver.getTableData(tableName, { page: 1, pageSize: 200 });

          const pkCol = sourceData.fields.find((f: any) => f.isPrimaryKey)?.name || sourceData.fields[0]?.name || 'id';

          const targetRowMap = new Map();
          targetData.rows.forEach((r: any) => targetRowMap.set(String(r[pkCol]), r));

          let syncSql = `-- Data Sync Script for table "${tableName}" from ${sourceConfig.name} to ${targetConn.name}\n\n`;
          let missingCount = 0;
          let updatedCount = 0;

          for (const sRow of sourceData.rows) {
            const pkVal = String(sRow[pkCol]);
            const tRow = targetRowMap.get(pkVal);

            if (!tRow) {
              missingCount++;
              const cols = Object.keys(sRow).map((k) => `"${k}"`).join(', ');
              const vals = Object.values(sRow).map((v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)).join(', ');
              syncSql += `INSERT INTO "${tableName}" (${cols}) VALUES (${vals});\n`;
            } else {
              // Check mismatch
              const updates: string[] = [];
              for (const [k, v] of Object.entries(sRow)) {
                if (String(v) !== String(tRow[k])) {
                  const valStr = v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
                  updates.push(`"${k}" = ${valStr}`);
                }
              }
              if (updates.length > 0) {
                updatedCount++;
                const pkValStr = typeof sRow[pkCol] === 'number' ? sRow[pkCol] : `'${sRow[pkCol]}'`;
                syncSql += `UPDATE "${tableName}" SET ${updates.join(', ')} WHERE "${pkCol}" = ${pkValStr};\n`;
              }
            }
          }

          panel.webview.postMessage({
            type: 'compareResult',
            missingCount,
            updatedCount,
            totalSource: sourceData.rows.length,
            syncSql,
          });
        } catch (err: any) {
          panel.webview.postMessage({ type: 'error', message: err.message });
        }
      } else if (msg.type === 'executeSync') {
        const targetConn = connections.find((c) => c.id === msg.targetId);
        if (!targetConn) return;
        try {
          const targetPass = await storageService.getPassword(targetConn.id);
          const targetSshPass = await storageService.getSshPassword(targetConn.id);
          const driver = await DriverManager.getInstance().getDriver(targetConn, targetPass, targetSshPass);
          await driver.executeQuery(msg.sql);
          vscode.window.showInformationMessage(t('Data synchronization completed!', 'Синхронизация данных успешно выполнена!'));
        } catch (err: any) {
          vscode.window.showErrorMessage(`Sync failed: ${err.message}`);
        }
      }
    });

    panel.webview.html = DataSyncWebviewProvider.getHtml(sourceConfig.name, tableName, connections);
  }

  private static getHtml(sourceConnName: string, tableName: string, connections: ConnectionConfig[]): string {
    const ru = isRussian();
    const connOptions = connections
      .map((c) => `<option value="${c.id}">${c.name} (${c.type})</option>`)
      .join('');

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${ru ? 'Синхронизация Данных' : 'Data Sync'}: ${tableName}</title>
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
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-weight: bold; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .card { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border, #333); border-radius: 6px; padding: 15px; }
    textarea { width: 100%; height: 250px; font-family: monospace; font-size: 13px; margin-top: 10px; box-sizing: border-box; }
    #errorBox { display: none; background: #7f1d1d; color: #fca5a5; padding: 10px; border-radius: 4px; margin-bottom: 15px; }
  </style>
</head>
<body>
  <h2>🔄 ${ru ? 'Сравнение и Синхронизация Данных Таблицы' : 'Data Comparison & Synchronization'}: "${tableName}"</h2>

  <div id="errorBox"></div>

  <div class="toolbar">
    <div><b>Source:</b> ${sourceConnName}</div>
    <div style="font-size: 20px;">➔</div>
    <div>
      <label><b>Target DB:</b></label>
      <select id="targetSelect">${connOptions}</select>
    </div>
    <button id="compareBtn">⚡ ${ru ? 'Сравнить Строки' : 'Compare Rows'}</button>
  </div>

  <div class="card">
    <h3 id="statsTitle">📊 ${ru ? 'Результаты Сравнения' : 'Comparison Summary'}</h3>
    <textarea id="sqlCode" readonly placeholder="${ru ? 'DML скрипт синхронизации (INSERT / UPDATE) появится здесь' : 'DML sync script (INSERT / UPDATE) will appear here'}"></textarea>
    <div style="margin-top:10px; display:flex; gap:10px;">
      <button id="copyBtn">📋 ${ru ? 'Копировать DML' : 'Copy DML'}</button>
      <button id="execBtn" style="background:#059669;">🚀 ${ru ? 'Применить Синхронизацию' : 'Apply Sync'}</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('compareBtn').onclick = () => {
      const targetId = document.getElementById('targetSelect').value;
      vscode.postMessage({ type: 'compare', targetId });
    };

    document.getElementById('copyBtn').onclick = () => {
      const sql = document.getElementById('sqlCode').value;
      navigator.clipboard.writeText(sql);
      alert('${ru ? 'DML скрипт скопирован!' : 'DML script copied!'}');
    };

    document.getElementById('execBtn').onclick = () => {
      const targetId = document.getElementById('targetSelect').value;
      const sql = document.getElementById('sqlCode').value;
      if (!sql.trim()) return;
      if (confirm('${ru ? 'Выполнить синхронизацию данных в целевую базу?' : 'Execute data sync on target database?'}')) {
        vscode.postMessage({ type: 'executeSync', targetId, sql });
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
      if (msg.type === 'compareResult') {
        errorBox.style.display = 'none';
        document.getElementById('statsTitle').innerText = \`📊 Missing Rows: \${msg.missingCount} | Modified Rows: \${msg.updatedCount} / Total: \${msg.totalSource}\`;
        document.getElementById('sqlCode').value = msg.syncSql;
      }
    });
  </script>
</body>
</html>`;
  }
}
