import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { isRussian, t } from '../util/i18n.js';

export class ProcessListWebviewProvider {
  public static async show(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string) {
    const title = t(`Process List: ${connectionConfig.name}`, `Процессы: ${connectionConfig.name}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientProcessList',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const loadProcesses = async () => {
      try {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
        let sql = 'SHOW PROCESSLIST;';
        if (connectionConfig.type === 'PostgreSQL') {
          sql = 'SELECT pid as id, usename as user, datname as db, state, query_start, query FROM pg_stat_activity WHERE pid != pg_backend_pid();';
        }

        const result = await driver.executeQuery(sql);
        panel.webview.postMessage({ type: 'renderProcesses', result });
      } catch (err: any) {
        panel.webview.postMessage({ type: 'error', message: err.message });
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'refresh':
          await loadProcesses();
          break;
        case 'killProcess':
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
            let killSql = `KILL ${msg.pid};`;
            if (connectionConfig.type === 'PostgreSQL') {
              killSql = `SELECT pg_terminate_backend(${msg.pid});`;
            }
            await driver.executeQuery(killSql);
            vscode.window.showInformationMessage(t(`Terminated process ${msg.pid}`, `Процесс ${msg.pid} успешно завершен`));
            await loadProcesses();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to kill process: ${e.message}`);
          }
          break;
      }
    });

    panel.webview.html = ProcessListWebviewProvider.getHtml(connectionConfig.name);
    await loadProcesses();
  }

  private static getHtml(connectionName: string): string {
    const ru = isRussian();
    const text = {
      title: ru ? '⚡ Мониторинг Активных Процессов' : '⚡ Active Server Process List',
      refresh: ru ? '🔄 Обновить' : '🔄 Refresh',
      kill: ru ? '❌ Завершить процесс' : '❌ Kill Process',
      time: ru ? 'Время' : 'Time',
      err: ru ? '❌ Ошибка:' : '❌ Error:',
    };

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${text.title}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 15px;
      margin: 0;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 15px;
    }
    button {
      padding: 6px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button.danger {
      background: #dc2626;
      color: white;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      text-align: left;
    }
    th {
      background: var(--vscode-editorHeader-noTabsBackground, #252526);
    }
    tr:hover {
      background: rgba(255,255,255,0.05);
    }
    #errorBox {
      display: none;
      background: #5a1d1d;
      color: #fca5a5;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h3>${text.title} [${connectionName}]</h3>
    <button id="refreshBtn">${text.refresh}</button>
  </div>

  <div id="errorBox"></div>

  <table>
    <thead><tr id="tableHead"></tr></thead>
    <tbody id="tableBody"></tbody>
  </table>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('refreshBtn').onclick = () => {
      vscode.postMessage({ type: 'refresh' });
    };

    function killProcess(pid) {
      if (confirm('${text.kill} ID: ' + pid + '?')) {
        vscode.postMessage({ type: 'killProcess', pid });
      }
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      const errorBox = document.getElementById('errorBox');

      if (msg.type === 'error') {
        errorBox.style.display = 'block';
        errorBox.innerText = '${text.err} ' + msg.message;
        return;
      }

      if (msg.type === 'renderProcesses') {
        errorBox.style.display = 'none';
        const res = msg.result;

        const headTr = document.getElementById('tableHead');
        headTr.innerHTML = res.fields.map(f => \`<th>\${f.name}</th>\`).join('') + '<th>Action</th>';

        const body = document.getElementById('tableBody');
        body.innerHTML = res.rows.map(row => {
          const pid = row.Id || row.id || row.PID || row.pid;
          const cells = res.fields.map(f => \`<td>\${row[f.name] === null ? '<i>null</i>' : String(row[f.name])}</td>\`).join('');
          const killBtn = pid ? \`<button class="danger" onclick="killProcess(\${pid})">Kill</button>\` : '';
          return \`<tr>\${cells}<td>\${killBtn}</td></tr>\`;
        }).join('');
      }
    });
  </script>
</body>
</html>`;
  }
}
