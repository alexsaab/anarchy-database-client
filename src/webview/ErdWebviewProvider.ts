import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
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
      const allRelations = [];

      for (const tbl of tables.slice(0, 30)) {
        const columns = await driver.getColumns(tbl.name, connectionConfig.database, tbl.schema);
        const fks = await driver.getForeignKeys(tbl.name, connectionConfig.database, tbl.schema);

        tableDataList.push({ name: tbl.name, schema: tbl.schema, columns, foreignKeys: fks });

        for (const fk of fks) {
          allRelations.push({
            fromTable: tbl.name,
            fromCol: fk.columnName,
            toTable: fk.foreignTableName,
            toCol: fk.foreignColumnName,
          });
        }
      }

      panel.webview.onDidReceiveMessage((msg) => {
        if (msg.type === 'copyMermaid') {
          vscode.env.clipboard.writeText(msg.mermaidCode);
          vscode.window.showInformationMessage(t('Copied Mermaid ER diagram code to clipboard!', 'Код Mermaid ER-диаграммы скопирован!'));
        }
      });

      panel.webview.html = ErdWebviewProvider.getHtml(connectionConfig.database || connectionConfig.name, tableDataList, allRelations);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to build ER Diagram: ${err.message}`);
    }
  }

  private static getHtml(databaseName: string, tables: any[], relations: any[]): string {
    const ru = isRussian();
    const tablesJson = JSON.stringify(tables);
    const relationsJson = JSON.stringify(relations);

    let mermaidCode = 'erDiagram\n';
    tables.forEach((t) => {
      mermaidCode += `    "${t.name}" {\n`;
      t.columns.forEach((c: any) => {
        const cleanType = (c.type || 'string').replace(/[\s(),]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'string';
        const cleanName = c.name.replace(/[\s()-]/g, '_');
        const keyType = c.isPrimaryKey ? 'PK' : t.foreignKeys.some((f: any) => f.columnName === c.name) ? 'FK' : '';
        mermaidCode += `        ${cleanType} ${cleanName} ${keyType}\n`;
      });
      mermaidCode += `    }\n`;
    });
    relations.forEach((r) => {
      mermaidCode += `    "${r.toTable}" ||--o{ "${r.fromTable}" : "${r.fromCol}"\n`;
    });

    const mermaidCodeJson = JSON.stringify(mermaidCode);

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
      position: relative;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    button {
      padding: 8px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
    }
    #svgCanvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10;
    }
    .diagram-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 50px;
      position: relative;
      z-index: 20;
    }
    .erd-table {
      background: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 6px;
      width: 280px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    .table-header {
      background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e);
      padding: 10px 12px;
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
    .pk { font-weight: bold; color: #facc15; }
    .fk { font-weight: bold; color: #c084fc; }
    .type { color: #98c379; font-size: 11px; }
    .rel-badge {
      font-size: 11px;
      background: #312e81;
      color: #a5b4fc;
      padding: 4px 8px;
      border-radius: 4px;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <svg id="svgCanvas"></svg>

  <div class="header">
    <h2>📊 ${ru ? 'Схема Связей со Стрелками (ER Diagram)' : 'Entity-Relationship Diagram'}: ${databaseName}</h2>
    <button id="copyMermaidBtn">📋 ${ru ? 'Копировать Mermaid Код' : 'Copy Mermaid Code'}</button>
  </div>

  <div class="diagram-grid" id="grid"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const tables = ${tablesJson};
    const relations = ${relationsJson};
    const mermaidCode = ${mermaidCodeJson};

    document.getElementById('copyMermaidBtn').onclick = () => {
      vscode.postMessage({ type: 'copyMermaid', mermaidCode });
    };

    const grid = document.getElementById('grid');

    tables.forEach(tbl => {
      const tableDiv = document.createElement('div');
      tableDiv.className = 'erd-table';
      tableDiv.id = 'table_' + tbl.name;

      let rowsHtml = tbl.columns.map(col => {
        const isPk = col.isPrimaryKey;
        const isFk = tbl.foreignKeys.some(f => f.columnName === col.name);
        const cls = isPk ? 'pk' : isFk ? 'fk' : '';
        const badge = isPk ? ' 🔑 PK' : isFk ? ' 🔗 FK' : '';
        return \`<div class="column-row \${cls}">
          <span>\${col.name}\${badge}</span>
          <span class="type">\${col.type}</span>
        </div>\`;
      }).join('');

      let relsHtml = tbl.foreignKeys.map(fk => \`
        <div class="rel-badge">🔗 \${fk.columnName} ➔ \${fk.foreignTableName}.\${fk.foreignColumnName}</div>
      \`).join('');

      tableDiv.innerHTML = \`<div class="table-header">📁 \${tbl.name}</div><div class="table-body">\${rowsHtml}</div>\${relsHtml ? '<div style="padding:8px;">' + relsHtml + '</div>' : ''}\`;
      grid.appendChild(tableDiv);
    });

    function drawConnections() {
      const svg = document.getElementById('svgCanvas');
      svg.style.width = Math.max(document.body.scrollWidth, window.innerWidth) + 'px';
      svg.style.height = Math.max(document.body.scrollHeight, window.innerHeight) + 'px';

      svg.innerHTML = \`
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#a5b4fc"/>
          </marker>
        </defs>
      \`;

      relations.forEach(rel => {
        const fromEl = document.getElementById('table_' + rel.fromTable);
        const toEl = document.getElementById('table_' + rel.toTable);

        if (fromEl && toEl) {
          const rect1 = fromEl.getBoundingClientRect();
          const rect2 = toEl.getBoundingClientRect();

          const x1 = rect1.left + rect1.width / 2 + window.scrollX;
          const y1 = rect1.top + rect1.height / 2 + window.scrollY;
          const x2 = rect2.left + rect2.width / 2 + window.scrollX;
          const y2 = rect2.top + rect2.height / 2 + window.scrollY;

          const dx = (x2 - x1) / 2;
          const d = \`M \${x1} \${y1} C \${x1 + dx} \${y1}, \${x2 - dx} \${y2}, \${x2} \${y2}\`;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', d);
          path.setAttribute('stroke', '#818cf8');
          path.setAttribute('stroke-width', '2.5');
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke-dasharray', '5,5');
          path.setAttribute('marker-end', 'url(#arrowhead)');
          svg.appendChild(path);
        }
      });
    }

    setTimeout(drawConnections, 300);
    window.onresize = drawConnections;
  </script>
</body>
</html>`;
  }
}
