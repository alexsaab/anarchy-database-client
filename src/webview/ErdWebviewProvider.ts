import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
import { DatabaseNode } from '../tree/DatabaseNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { isRussian, t } from '../util/i18n.js';

export class ErdWebviewProvider {
  public static async show(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string) {
    const title = t(`ER Diagram: ${connectionConfig.database || connectionConfig.name}`, `ER-Диаграмма: ${connectionConfig.database || connectionConfig.name}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientErd',
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

      const tableDataList = [];
      for (const tbl of tables.slice(0, 30)) { // Limit to 30 tables for clean diagram rendering
        const columns = await driver.getColumns(tbl.name, connectionConfig.database, tbl.schema);
        tableDataList.push({ name: tbl.name, schema: tbl.schema, columns });
      }

      panel.webview.html = ErdWebviewProvider.getHtml(connectionConfig.database || connectionConfig.name, tableDataList);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to build ER Diagram: ${err.message}`);
    }
  }

  private static getHtml(databaseName: string, tables: any[]): string {
    const ru = isRussian();
    const tablesJson = JSON.stringify(tables);

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${ru ? 'ER-Диаграмма' : 'ER Diagram'}: ${databaseName}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
      padding: 20px;
      overflow: auto;
    }
    h2 {
      margin-top: 0;
      color: var(--vscode-symbolIcon-keywordForeground, #007acc);
    }
    .diagram-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
    }
    .erd-table {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 6px;
      width: 260px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    .table-header {
      background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e);
      padding: 8px 12px;
      font-weight: bold;
      border-bottom: 1px solid var(--vscode-panel-border, #444);
      border-top-left-radius: 5px;
      border-top-right-radius: 5px;
      color: #61afef;
    }
    .column-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 12px;
      font-size: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .pk {
      font-weight: bold;
      color: #facc15;
    }
    .type {
      color: #98c379;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <h2>📊 ${ru ? 'Схема Таблиц (ER Diagram)' : 'Entity-Relationship Diagram'}: ${databaseName}</h2>
  <div class="diagram-grid" id="grid"></div>

  <script>
    const tables = ${tablesJson};
    const grid = document.getElementById('grid');

    tables.forEach(tbl => {
      const tableDiv = document.createElement('div');
      tableDiv.className = 'erd-table';

      let rowsHtml = tbl.columns.map(col => {
        const pkClass = col.isPrimaryKey ? 'pk' : '';
        const pkBadge = col.isPrimaryKey ? ' 🔑' : '';
        return \`<div class="column-row \${pkClass}">
          <span>\${col.name}\${pkBadge}</span>
          <span class="type">\${col.type}</span>
        </div>\`;
      }).join('');

      tableDiv.innerHTML = \`<div class="table-header">📁 \${tbl.name}</div><div class="table-body">\${rowsHtml}</div>\`;
      grid.appendChild(tableDiv);
    });
  </script>
</body>
</html>`;
  }
}
