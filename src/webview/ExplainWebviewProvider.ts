import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian, t } from '../util/i18n.js';

export class ExplainWebviewProvider {
  public static async show(connectionConfig: ConnectionConfig, sql: string, password?: string, sshPassword?: string) {
    const title = t(`Execution Plan (EXPLAIN): ${connectionConfig.name}`, `План Выполнения (EXPLAIN): ${connectionConfig.name}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientExplain',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    try {
      const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
      let explainSql = `EXPLAIN ${sql}`;

      if (connectionConfig.type === 'PostgreSQL') {
        explainSql = `EXPLAIN (FORMAT JSON, VERBOSE) ${sql}`;
      } else if (connectionConfig.type === 'MySQL') {
        explainSql = `EXPLAIN FORMAT=JSON ${sql}`;
      }

      const res = await driver.executeQuery(explainSql);
      panel.webview.html = ExplainWebviewProvider.getHtml(connectionConfig.name, sql, res.rows, connectionConfig.type);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to generate Execution Plan: ${err.message}`);
    }
  }

  private static getHtml(connectionName: string, sql: string, rows: any[], dbType: string): string {
    const ru = isRussian();
    const rowsJson = JSON.stringify(rows);

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${ru ? 'План Выполнения Запроса' : 'Execution Plan Visualizer'}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }
    .card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 15px;
      margin-bottom: 20px;
    }
    .sql-code {
      font-family: monospace;
      font-size: 13px;
      color: #61afef;
      background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e);
      padding: 10px;
      border-radius: 4px;
    }
    .node-card {
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
      background: var(--vscode-editor-background);
    }
    .node-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: bold;
      font-size: 14px;
    }
    .badge-scan { background: #b91c1c; color: #fecaca; padding: 3px 8px; border-radius: 4px; font-size: 11px; }
    .badge-index { background: #15803d; color: #dcfce7; padding: 3px 8px; border-radius: 4px; font-size: 11px; }
    .badge-join { background: #d97706; color: #fef3c7; padding: 3px 8px; border-radius: 4px; font-size: 11px; }
    .node-details { font-size: 12px; opacity: 0.8; margin-top: 6px; }
    .warning-box {
      background: #451a03;
      border: 1px solid #b45309;
      color: #fde68a;
      padding: 10px;
      border-radius: 6px;
      margin-top: 15px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <h2>⚡ ${ru ? 'Визуализатор Плана Выполнения (EXPLAIN)' : 'Execution Plan Visualizer'}: ${connectionName}</h2>

  <div class="card">
    <b>SQL Query:</b>
    <div class="sql-code">${sql}</div>
  </div>

  <div class="card">
    <h3>🌳 ${ru ? 'Дерево Выполнения Запроса' : 'Query Execution Tree'}</h3>
    <div id="planTree"></div>
  </div>

  <div class="card">
    <h3>💡 ${ru ? 'Рекомендации по Оптимизации' : 'Optimization Insights'}</h3>
    <div id="insights"></div>
  </div>

  <script>
    const rows = ${rowsJson};
    const treeDiv = document.getElementById('planTree');
    const insightsDiv = document.getElementById('insights');

    let rawText = JSON.stringify(rows, null, 2);
    let isSeqScan = rawText.includes('Seq Scan') || rawText.includes('ALL');

    treeDiv.innerHTML = '<pre class="sql-code">' + rawText + '</pre>';

    let insightHtml = '';
    if (isSeqScan) {
      insightHtml += '<div class="warning-box">⚠️ <b>${ru ? 'Внимание: Полное сканирование таблицы (Seq Scan / ALL)' : 'Warning: Sequential Table Scan Detected'}</b><br>${ru ? 'Запрос сканирует всю таблицу без использования индекса. Рекомендуется добавить индекс по полям фильтрации WHERE или JOIN.' : 'Query scans full table without index. Consider adding an index on WHERE / JOIN columns.'}</div>';
    } else {
      insightHtml += '<div style="color:#4ade80;">✅ ${ru ? 'Запрос эффективно использует индексы!' : 'Query utilizes indexes effectively!'}</div>';
    }

    insightsDiv.innerHTML = insightHtml;
  </script>
</body>
</html>`;
  }
}
