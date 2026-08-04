import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
import { TableNode } from '../tree/TableNode.js';
import { isRussian, t } from '../util/i18n.js';

export class TableDesignWebviewProvider {
  public static async show(tableNode: TableNode) {
    const title = t(`Design: ${tableNode.table.name}`, `Конструктор: ${tableNode.table.name}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientTableDesign',
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

    const loadColumns = async () => {
      try {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, tableNode.password, tableNode.sshPassword);
        const columns = await driver.getColumns(tableName, connectionConfig.database, schemaName);
        panel.webview.postMessage({ type: 'renderColumns', columns });
      } catch (err: any) {
        panel.webview.postMessage({ type: 'error', message: err.message });
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'addColumn': {
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, tableNode.password, tableNode.sshPassword);
            const sql = `ALTER TABLE "${tableName}" ADD COLUMN "${msg.col.name}" ${msg.col.type}${msg.col.nullable ? '' : ' NOT NULL'};`;
            await driver.executeQuery(sql);
            vscode.window.showInformationMessage(t(`Added column "${msg.col.name}"`, `Колонка "${msg.col.name}" добавлена`));
            await loadColumns();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to add column: ${e.message}`);
          }
          break;
        }
        case 'editColumn': {
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, tableNode.password, tableNode.sshPassword);
            let alterSql = '';
            if (connectionConfig.type === 'PostgreSQL') {
              alterSql = `ALTER TABLE "${tableName}" RENAME COLUMN "${msg.oldName}" TO "${msg.newName}";\nALTER TABLE "${tableName}" ALTER COLUMN "${msg.newName}" TYPE ${msg.newType};`;
            } else {
              alterSql = `ALTER TABLE \`${tableName}\` CHANGE \`${msg.oldName}\` \`${msg.newName}\` ${msg.newType};`;
            }
            await driver.executeQuery(alterSql);
            vscode.window.showInformationMessage(t(`Updated column "${msg.newName}"`, `Колонка "${msg.newName}" обновлена`));
            await loadColumns();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to edit column: ${e.message}`);
          }
          break;
        }
        case 'dropColumn': {
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, tableNode.password, tableNode.sshPassword);
            const sql = `ALTER TABLE "${tableName}" DROP COLUMN "${msg.columnName}";`;
            await driver.executeQuery(sql);
            vscode.window.showInformationMessage(t(`Dropped column "${msg.columnName}"`, `Колонка "${msg.columnName}" удалена`));
            await loadColumns();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to drop column: ${e.message}`);
          }
          break;
        }
      }
    });

    panel.webview.html = TableDesignWebviewProvider.getHtml(tableName);
    await loadColumns();
  }

  private static getHtml(tableName: string): string {
    const ru = isRussian();
    const text = {
      title: ru ? '🛠 Конструктор Таблицы (Редактирование Колонок)' : '🛠 Table Designer & Column Editor',
      addCol: ru ? '➕ Добавить Колонку' : '➕ Add Column',
      colName: ru ? 'Имя колонки' : 'Column Name',
      colType: ru ? 'Тип данных' : 'Data Type',
      nullable: ru ? 'NULLABLE' : 'NULLABLE',
      pk: ru ? 'PRIMARY KEY' : 'PRIMARY KEY',
      actions: ru ? 'Действия' : 'Actions',
      edit: ru ? '✏️ Изменить' : '✏️ Edit',
      drop: ru ? '🗑️ Удалить' : '🗑️ Drop',
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
    .toolbar {
      display: flex;
      gap: 10px;
      margin-bottom: 15px;
      background: var(--vscode-sideBar-background);
      padding: 10px;
      border-radius: 4px;
      align-items: center;
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
      font-weight: bold;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
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
  </style>
</head>
<body>
  <h3>${text.title}: ${tableName}</h3>

  <div class="toolbar">
    <input type="text" id="newColName" placeholder="${text.colName}">
    <select id="newColType">
      <option value="VARCHAR(255)">VARCHAR(255)</option>
      <option value="TEXT">TEXT</option>
      <option value="INTEGER">INTEGER</option>
      <option value="BIGINT">BIGINT</option>
      <option value="BOOLEAN">BOOLEAN</option>
      <option value="TIMESTAMP">TIMESTAMP</option>
      <option value="JSON">JSON</option>
    </select>
    <label><input type="checkbox" id="newColNullable" checked> ${text.nullable}</label>
    <button id="addBtn">${text.addCol}</button>
  </div>

  <table>
    <thead>
      <tr>
        <th>${text.colName}</th>
        <th>${text.colType}</th>
        <th>${text.nullable}</th>
        <th>${text.pk}</th>
        <th>${text.actions}</th>
      </tr>
    </thead>
    <tbody id="colBody"></tbody>
  </table>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('addBtn').onclick = () => {
      const name = document.getElementById('newColName').value;
      const type = document.getElementById('newColType').value;
      const nullable = document.getElementById('newColNullable').checked;

      if (!name) return;
      vscode.postMessage({ type: 'addColumn', col: { name, type, nullable } });
    };

    function editCol(oldName, oldType) {
      const newName = prompt('Enter new column name:', oldName);
      if (!newName) return;
      const newType = prompt('Enter data type (e.g. VARCHAR(255), INT, TEXT):', oldType);
      if (!newType) return;

      vscode.postMessage({ type: 'editColumn', oldName, newName, newType });
    }

    function dropCol(colName) {
      if (confirm('Drop column "' + colName + '"?')) {
        vscode.postMessage({ type: 'dropColumn', columnName: colName });
      }
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'renderColumns') {
        const body = document.getElementById('colBody');
        body.innerHTML = msg.columns.map(c => \`
          <tr>
            <td><b>\${c.name}</b></td>
            <td>\${c.type}</td>
            <td>\${c.nullable ? 'YES' : 'NO'}</td>
            <td>\${c.isPrimaryKey ? '🔑 YES' : 'NO'}</td>
            <td>
              <button class="secondary" onclick="editCol('\${c.name}', '\${c.type}')">${text.edit}</button>
              <button class="danger" onclick="dropCol('\${c.name}')">${text.drop}</button>
            </td>
          </tr>
        \`).join('');
      }
    });
  </script>
</body>
</html>`;
  }
}
