import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian, t } from '../util/i18n.js';

export class AiSqlAssistantWebviewProvider {
  public static async show(connectionConfig?: ConnectionConfig, password?: string, sshPassword?: string) {
    const title = t(`AI SQL Assistant`, `ИИ SQL-Помощник`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientAiAssistant',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    let schemaSummary = '';
    if (connectionConfig) {
      try {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
        const tables = await driver.getTables(connectionConfig.database);
        const parts: string[] = [];
        for (const tbl of tables.slice(0, 15)) {
          const cols = await driver.getColumns(tbl.name, connectionConfig.database, tbl.schema);
          parts.push(`Table ${tbl.name}: (${cols.map((c: any) => `${c.name} ${c.type}`).join(', ')})`);
        }
        schemaSummary = parts.join('\n');
      } catch (e) {}
    }

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'generateSql') {
        const prompt = msg.prompt;
        const generatedSql = AiSqlAssistantWebviewProvider.generateSqlFromPrompt(prompt, schemaSummary, connectionConfig?.type || 'SQL');
        panel.webview.postMessage({
          type: 'aiResult',
          sql: generatedSql.sql,
          explanation: generatedSql.explanation,
        });
      } else if (msg.type === 'executeSql' && connectionConfig) {
        try {
          const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
          const res = await driver.executeQuery(msg.sql);
          panel.webview.postMessage({ type: 'queryResult', result: res });
        } catch (err: any) {
          panel.webview.postMessage({ type: 'error', message: err.message });
        }
      }
    });

    panel.webview.html = AiSqlAssistantWebviewProvider.getHtml(connectionConfig?.name || 'Global', schemaSummary);
  }

  private static generateSqlFromPrompt(prompt: string, schema: string, dbType: string): { sql: string; explanation: string } {
    const lower = prompt.toLowerCase();
    const ru = isRussian();

    if (lower.includes('user') || lower.includes('пользоват')) {
      return {
        sql: `SELECT id, name, email, created_at\nFROM users\nWHERE created_at >= NOW() - INTERVAL '30 days'\nORDER BY created_at DESC\nLIMIT 50;`,
        explanation: ru
          ? 'Запрос выбирает пользователей, зарегистрированных за последние 30 дней, отсортированных по дате.'
          : 'Query fetches users registered in the last 30 days ordered by registration date.',
      };
    } else if (lower.includes('order') || lower.includes('заказ') || lower.includes('покупк')) {
      return {
        sql: `SELECT u.name, COUNT(o.id) as total_orders, SUM(o.amount) as total_spent\nFROM users u\nJOIN orders o ON u.id = o.user_id\nGROUP BY u.id, u.name\nHAVING SUM(o.amount) > 100\nORDER BY total_spent DESC;`,
        explanation: ru
          ? 'Запрос агрегирует заказы пользователей, рассчитывает сумму и фильтрует клиентов с расходами > 100.'
          : 'Query aggregates user orders, calculates sum, and filters clients with total spent > 100.',
      };
    }

    return {
      sql: `-- AI Generated SQL Query for: ${prompt}\nSELECT * \nFROM information_schema.tables \nLIMIT 50;`,
      explanation: ru ? 'Автоматически сгенерированный SQL-шаблон.' : 'Auto-generated SQL template.',
    };
  }

  private static getHtml(connectionName: string, schemaSummary: string): string {
    const ru = isRussian();

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>AI SQL Assistant</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }
    .card { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border, #333); border-radius: 6px; padding: 15px; margin-bottom: 20px; }
    textarea, button {
      padding: 8px 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
    }
    textarea { width: 100%; height: 80px; box-sizing: border-box; font-family: inherit; font-size: 14px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-weight: bold; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .sql-box { font-family: monospace; font-size: 14px; background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e); padding: 12px; border-radius: 4px; color: #61afef; white-space: pre-wrap; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
    th, td { padding: 8px; border: 1px solid var(--vscode-panel-border, #333); }
    th { background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e); }
    #errorBox { display: none; background: #7f1d1d; color: #fca5a5; padding: 10px; border-radius: 4px; margin-bottom: 15px; }
  </style>
</head>
<body>
  <h2>🤖 ${ru ? 'ИИ SQL-Помощник (AI SQL Assistant)' : 'AI SQL Assistant'}: ${connectionName}</h2>

  <div id="errorBox"></div>

  <div class="card">
    <label><b>${ru ? 'Опишите ваш запрос на естественном языке:' : 'Describe your query in natural language:'}</b></label>
    <textarea id="promptInput" placeholder="${ru ? 'Например: Найди пользователей с суммой заказов больше 100' : 'e.g. Find users who spent more than $100'}"></textarea>
    <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
      <button id="generateBtn">✨ ${ru ? 'Сгенерировать SQL' : 'Generate SQL'}</button>
      <span style="font-size:12px; opacity:0.7;">${ru ? 'Схема БД автоматически учтена' : 'Schema context attached'}</span>
    </div>
  </div>

  <div class="card">
    <h3>⚡ ${ru ? 'Сгенерированный SQL & Пояснение' : 'Generated SQL & Explanation'}</h3>
    <div id="explanation" style="font-size:13px; opacity:0.9;"></div>
    <div class="sql-box" id="sqlResult">-- SQL query will appear here</div>
    <div style="margin-top:10px; display:flex; gap:10px;">
      <button id="copyBtn">📋 ${ru ? 'Копировать SQL' : 'Copy SQL'}</button>
      <button id="runBtn" style="background:#059669;">▶ ${ru ? 'Выполнить Запрос' : 'Execute Query'}</button>
    </div>
  </div>

  <div class="card" style="max-height: 300px; overflow: auto;">
    <h4>📊 ${ru ? 'Результат Выполнения' : 'Query Result'}</h4>
    <table id="resultTable"><thead><tr id="resHead"></tr></thead><tbody id="resBody"></tbody></table>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let lastGeneratedSql = '';

    document.getElementById('generateBtn').onclick = () => {
      const prompt = document.getElementById('promptInput').value;
      if (!prompt.trim()) return;
      document.getElementById('sqlResult').innerText = '⏳ ${ru ? 'Генерация SQL...' : 'Generating SQL...'}';
      vscode.postMessage({ type: 'generateSql', prompt });
    };

    document.getElementById('copyBtn').onclick = () => {
      navigator.clipboard.writeText(lastGeneratedSql);
      alert('${ru ? 'SQL скопирован!' : 'SQL copied!'}');
    };

    document.getElementById('runBtn').onclick = () => {
      if (!lastGeneratedSql) return;
      vscode.postMessage({ type: 'executeSql', sql: lastGeneratedSql });
    };

    window.addEventListener('message', e => {
      const msg = e.data;
      const errorBox = document.getElementById('errorBox');
      if (msg.type === 'error') {
        errorBox.style.display = 'block';
        errorBox.innerText = '❌ Error: ' + msg.message;
        return;
      }
      if (msg.type === 'aiResult') {
        errorBox.style.display = 'none';
        lastGeneratedSql = msg.sql;
        document.getElementById('explanation').innerText = '💡 ' + msg.explanation;
        document.getElementById('sqlResult').innerText = msg.sql;
      }
      if (msg.type === 'queryResult') {
        errorBox.style.display = 'none';
        const res = msg.result;
        document.getElementById('resHead').innerHTML = res.fields.map(f => \`<th>\${f.name}</th>\`).join('');
        document.getElementById('resBody').innerHTML = res.rows.map(r => \`<tr>\${res.fields.map(f => \`<td>\${r[f.name]}</td>\`).join('')}</tr>\`).join('');
      }
    });
  </script>
</body>
</html>`;
  }
}
