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
    const db = connectionConfig.database || schemaName;

    const loadColumns = async () => {
      try {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, tableNode.password, tableNode.sshPassword);
        if (db && connectionConfig.type === 'MySQL') {
          await driver.executeQuery(`USE \`${db}\`;`);
        }

        const columns = await driver.getColumns(tableName, db, schemaName);
        let tableComment = '';

        try {
          if (connectionConfig.type === 'MySQL') {
            const res = await driver.executeQuery(
              `SELECT TABLE_COMMENT FROM information_schema.tables WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${tableName}';`
            );
            tableComment = res.rows[0]?.TABLE_COMMENT || res.rows[0]?.table_comment || '';
          } else if (connectionConfig.type === 'PostgreSQL') {
            const res = await driver.executeQuery(
              `SELECT obj_description(c.oid) as comment FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = '${tableName}' AND n.nspname = '${schemaName}';`
            );
            tableComment = res.rows[0]?.comment || '';
          }
        } catch (e) {
          // Ignore comment query errors
        }

        panel.webview.postMessage({ type: 'renderColumns', columns, tableComment });
      } catch (err: any) {
        panel.webview.postMessage({ type: 'error', message: err.message });
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'setTableComment': {
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, tableNode.password, tableNode.sshPassword);
            if (db && connectionConfig.type === 'MySQL') {
              await driver.executeQuery(`USE \`${db}\`;`);
            }
            let sql = '';
            if (connectionConfig.type === 'PostgreSQL') {
              sql = `COMMENT ON TABLE "${schemaName}"."${tableName}" IS '${(msg.comment || '').replace(/'/g, "''")}';`;
            } else {
              sql = `ALTER TABLE \`${tableName}\` COMMENT = '${(msg.comment || '').replace(/'/g, "''")}';`;
            }
            await driver.executeQuery(sql);
            vscode.window.showInformationMessage(t('Table comment updated!', 'Комментарий к таблице обновлен!'));
            await loadColumns();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to set table comment: ${e.message}`);
          }
          break;
        }
        case 'setColumnComment': {
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, tableNode.password, tableNode.sshPassword);
            if (db && connectionConfig.type === 'MySQL') {
              await driver.executeQuery(`USE \`${db}\`;`);
            }
            let sql = '';
            if (connectionConfig.type === 'PostgreSQL') {
              sql = `COMMENT ON COLUMN "${schemaName}"."${tableName}"."${msg.columnName}" IS '${(msg.comment || '').replace(/'/g, "''")}';`;
            } else {
              const cols = await driver.getColumns(tableName, db, schemaName);
              const colInfo = cols.find((c) => c.name === msg.columnName);
              const colType = colInfo ? colInfo.type : msg.columnType;
              const nullSql = colInfo && !colInfo.nullable ? ' NOT NULL' : '';
              const defSql = colInfo && colInfo.defaultValue !== undefined && colInfo.defaultValue !== null ? ` DEFAULT '${colInfo.defaultValue}'` : '';
              sql = `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${msg.columnName}\` ${colType}${nullSql}${defSql} COMMENT '${(msg.comment || '').replace(/'/g, "''")}';`;
            }
            await driver.executeQuery(sql);
            vscode.window.showInformationMessage(t(`Comment for "${msg.columnName}" updated!`, `Комментарий для колонки "${msg.columnName}" обновлен!`));
            await loadColumns();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to set column comment: ${e.message}`);
          }
          break;
        }
        case 'addColumn': {
          try {
            const driver = await DriverManager.getInstance().getDriver(connectionConfig, tableNode.password, tableNode.sshPassword);
            if (db && connectionConfig.type === 'MySQL') {
              await driver.executeQuery(`USE \`${db}\`;`);
            }
            const sql = connectionConfig.type === 'MySQL'
              ? `ALTER TABLE \`${tableName}\` ADD COLUMN \`${msg.col.name}\` ${msg.col.type}${msg.col.nullable ? '' : ' NOT NULL'};`
              : `ALTER TABLE "${tableName}" ADD COLUMN "${msg.col.name}" ${msg.col.type}${msg.col.nullable ? '' : ' NOT NULL'};`;
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
            if (db && connectionConfig.type === 'MySQL') {
              await driver.executeQuery(`USE \`${db}\`;`);
            }
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
            if (db && connectionConfig.type === 'MySQL') {
              await driver.executeQuery(`USE \`${db}\`;`);
            }
            const sql = connectionConfig.type === 'MySQL'
              ? `ALTER TABLE \`${tableName}\` DROP COLUMN \`${msg.columnName}\`;`
              : `ALTER TABLE "${tableName}" DROP COLUMN "${msg.columnName}";`;
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
      title: ru ? '🛠 Конструктор Таблицы и Комментариев' : '🛠 Table & Comment Designer',
      addCol: ru ? '➕ Добавить Колонку' : '➕ Add Column',
      colName: ru ? 'Имя колонки' : 'Column Name',
      colType: ru ? 'Тип данных' : 'Data Type',
      nullable: ru ? 'NULLABLE' : 'NULLABLE',
      pk: ru ? 'PRIMARY KEY' : 'PRIMARY KEY',
      comment: ru ? 'Комментарий' : 'Comment',
      actions: ru ? 'Действия' : 'Actions',
      edit: ru ? '✏️ Изменить' : '✏️ Edit',
      editComment: ru ? '💬 Комментарий' : '💬 Comment',
      tableCommentBtn: ru ? '💬 Комментарий Таблицы' : '💬 Table Comment',
      drop: ru ? '🗑️ Удалить' : '🗑️ Drop',
      save: ru ? 'Сохранить' : 'Save',
      cancel: ru ? 'Отмена' : 'Cancel',
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
      flex-wrap: wrap;
    }
    input, select, button, textarea {
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
    .comment-tag {
      font-style: italic;
      color: #98c379;
      font-size: 12px;
    }
    .table-comment-badge {
      font-size: 12px;
      color: #61afef;
      font-style: italic;
    }

    /* Modal Overlay */
    #modalOverlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal-content {
      background: var(--vscode-sideBar-background);
      padding: 20px;
      border-radius: 6px;
      width: 420px;
      max-width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      border: 1px solid var(--vscode-panel-border, #555);
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    .modal-form-group {
      margin-bottom: 12px;
    }
    .modal-form-group label {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
      font-weight: bold;
    }
    .modal-actions {
      display: flex;
      gap: 10px;
      margin-top: 18px;
      justify-content: flex-end;
    }
  </style>
</head>
<body>
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
    <h3 style="margin:0;">${text.title}: ${tableName}</h3>
    <span class="table-comment-badge" id="tableCommentDisplay"><i>no comment</i></span>
  </div>

  <div class="toolbar">
    <button class="secondary" id="tableCommentBtn">${text.tableCommentBtn}</button>

    <span style="border-left: 1px solid #555; margin: 0 5px; height: 18px;"></span>

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
        <th>${text.comment}</th>
        <th>${text.actions}</th>
      </tr>
    </thead>
    <tbody id="colBody"></tbody>
  </table>

  <!-- HTML Modal -->
  <div id="modalOverlay">
    <div class="modal-content">
      <h3 id="modalTitle" style="margin-top:0;">Modal</h3>
      <div id="modalBody"></div>
      <div class="modal-actions">
        <button class="secondary" onclick="closeModal()">${text.cancel}</button>
        <button id="modalConfirmBtn">${text.save}</button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentTableComment = '';

    function openModal(title, bodyHtml, onConfirm) {
      document.getElementById('modalTitle').innerText = title;
      document.getElementById('modalBody').innerHTML = bodyHtml;
      document.getElementById('modalOverlay').style.display = 'flex';

      const confirmBtn = document.getElementById('modalConfirmBtn');
      confirmBtn.onclick = () => {
        onConfirm();
        closeModal();
      };
    }

    function closeModal() {
      document.getElementById('modalOverlay').style.display = 'none';
    }

    document.getElementById('tableCommentBtn').onclick = () => {
      const html = \`
        <div class="modal-form-group">
          <label>${ru ? 'Введите комментарий для таблицы' : 'Enter table comment'}:</label>
          <textarea id="tableCommentInput" style="width:100%; height:80px;" placeholder="Comment...">\${currentTableComment || ''}</textarea>
        </div>
      \`;

      openModal('${text.tableCommentBtn}', html, () => {
        const comment = document.getElementById('tableCommentInput').value;
        vscode.postMessage({ type: 'setTableComment', comment });
      });
    };

    document.getElementById('addBtn').onclick = () => {
      const name = document.getElementById('newColName').value;
      const type = document.getElementById('newColType').value;
      const nullable = document.getElementById('newColNullable').checked;

      if (!name) return;
      vscode.postMessage({ type: 'addColumn', col: { name, type, nullable } });
    };

    function editCol(oldName, oldType) {
      const html = \`
        <div class="modal-form-group">
          <label>Column Name:</label>
          <input type="text" id="editColName" value="\${oldName}" style="width:100%;">
        </div>
        <div class="modal-form-group">
          <label>Data Type:</label>
          <input type="text" id="editColType" value="\${oldType}" style="width:100%;">
        </div>
      \`;

      openModal('${ru ? 'Редактировать колонку' : 'Edit Column'}: ' + oldName, html, () => {
        const newName = document.getElementById('editColName').value;
        const newType = document.getElementById('editColType').value;
        if (newName && newType) {
          vscode.postMessage({ type: 'editColumn', oldName, newName, newType });
        }
      });
    }

    function editColComment(colName, colType, currentComment) {
      const html = \`
        <div class="modal-form-group">
          <label>${ru ? 'Комментарий к колонке' : 'Column Comment'} "\${colName}":</label>
          <textarea id="colCommentInput" style="width:100%; height:80px;">\${currentComment || ''}</textarea>
        </div>
      \`;

      openModal('${ru ? 'Комментарий колонки' : 'Column Comment'}: ' + colName, html, () => {
        const comment = document.getElementById('colCommentInput').value;
        vscode.postMessage({ type: 'setColumnComment', columnName: colName, columnType: colType, comment });
      });
    }

    function dropCol(colName) {
      const html = \`<p>${ru ? 'Удалить колонку' : 'Drop column'} <b>\${colName}</b>?</p>\`;
      openModal('${ru ? 'Подтвердите удаление' : 'Confirm Deletion'}', html, () => {
        vscode.postMessage({ type: 'dropColumn', columnName: colName });
      });
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'renderColumns') {
        currentTableComment = msg.tableComment || '';
        document.getElementById('tableCommentDisplay').innerHTML = currentTableComment ? '💬 ' + currentTableComment : '<i>no comment</i>';

        const body = document.getElementById('colBody');
        body.innerHTML = msg.columns.map(c => \`
          <tr>
            <td><b>\${c.name}</b></td>
            <td>\${c.type}</td>
            <td>\${c.nullable ? 'YES' : 'NO'}</td>
            <td>\${c.isPrimaryKey ? '🔑 YES' : 'NO'}</td>
            <td class="comment-tag">\${c.comment ? '💬 ' + c.comment : '<i>-</i>'}</td>
            <td>
              <button class="secondary" onclick="editColComment('\${c.name}', '\${c.type}', '\${c.comment ? c.comment.replace(/'/g, "\\\\'") : ''}')">${text.editComment}</button>
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
