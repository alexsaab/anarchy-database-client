import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian, t } from '../util/i18n.js';

export class ExplainWebviewProvider {
  public static async show(
    connectionConfig: ConnectionConfig,
    sql: string,
    password?: string,
    sshPassword?: string,
    analyze: boolean = false
  ) {
    const title = t(
      `Execution Plan (EXPLAIN): ${connectionConfig.name}`,
      `План Выполнения (EXPLAIN): ${connectionConfig.name}`
    );
    const panel = vscode.window.createWebviewPanel(
      'dbClientExplain',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    const executeExplain = async (isAnalyze: boolean) => {
      try {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
        let explainSql = `EXPLAIN ${sql}`;

        if (connectionConfig.type === 'PostgreSQL') {
          explainSql = isAnalyze
            ? `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${sql}`
            : `EXPLAIN (VERBOSE, FORMAT JSON) ${sql}`;
        } else if (connectionConfig.type === 'MySQL') {
          explainSql = isAnalyze ? `EXPLAIN ANALYZE ${sql}` : `EXPLAIN FORMAT=JSON ${sql}`;
        } else if (connectionConfig.type === 'SQLite') {
          explainSql = `EXPLAIN QUERY PLAN ${sql}`;
        } else if (connectionConfig.type === 'DuckDB') {
          explainSql = isAnalyze ? `EXPLAIN ANALYZE ${sql}` : `EXPLAIN ${sql}`;
        } else if (connectionConfig.type === 'ClickHouse') {
          explainSql = `EXPLAIN PLAN ${sql}`;
        }

        let res;
        try {
          res = await driver.executeQuery(explainSql);
        } catch (err: any) {
          if (isAnalyze && connectionConfig.type === 'MySQL') {
            // Older MySQL doesn't support EXPLAIN ANALYZE, fall back to EXPLAIN FORMAT=JSON
            explainSql = `EXPLAIN FORMAT=JSON ${sql}`;
            res = await driver.executeQuery(explainSql);
          } else {
            throw err;
          }
        }

        panel.webview.html = ExplainWebviewProvider.getHtml(
          connectionConfig.name,
          sql,
          res.rows,
          connectionConfig.type,
          isAnalyze,
          res.costTimeMs
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to generate Execution Plan: ${err.message}`);
      }
    };

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'reExplain') {
        await executeExplain(!!msg.analyze);
      }
    });

    await executeExplain(analyze);
  }

  private static getHtml(
    connectionName: string,
    sql: string,
    rows: any[],
    dbType: string,
    isAnalyze: boolean,
    costTimeMs: number = 0
  ): string {
    const ru = isRussian();
    const rowsJson = JSON.stringify(rows);
    const escapedSql = sql
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">
  <title>${ru ? 'План Выполнения Запроса' : 'Execution Plan Visualizer'}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 18px 24px;
      margin: 0;
      line-height: 1.5;
    }
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      padding-bottom: 12px;
    }
    .top-header h2 {
      margin: 0;
      font-size: 18px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-db { background: #2563eb; color: #fff; }
    .badge-time { background: #059669; color: #fff; }
    .controls {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    button {
      padding: 5px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 16px;
    }
    .sql-code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      color: #9cdcfe;
      background: var(--vscode-editorHeader-noTabsBackground, #1e1e1e);
      padding: 10px;
      border-radius: 4px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 120px;
      overflow-y: auto;
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .tab-btn {
      padding: 6px 14px;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border, #444);
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      font-size: 12px;
    }
    .tab-btn.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: bold;
      border-color: transparent;
    }
    .plan-node {
      border-left: 4px solid #4b5563;
      background: var(--vscode-editor-background);
      border-radius: 4px;
      padding: 10px 14px;
      margin-bottom: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }
    .plan-node.scan-full { border-left-color: #ef4444; }
    .plan-node.scan-index { border-left-color: #10b981; }
    .plan-node.join-op { border-left-color: #f59e0b; }
    .node-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .node-title {
      font-weight: 600;
      font-size: 13px;
    }
    .node-badges {
      display: flex;
      gap: 6px;
    }
    .scan-badge-danger { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
    .scan-badge-success { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; }
    .scan-badge-warning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; }
    .node-metrics {
      display: flex;
      gap: 16px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      flex-wrap: wrap;
    }
    .cost-bar-container {
      width: 100%;
      height: 4px;
      background: rgba(255,255,255,0.1);
      border-radius: 2px;
      margin-top: 8px;
      overflow: hidden;
    }
    .cost-bar-fill {
      height: 100%;
      background: #38bdf8;
      border-radius: 2px;
    }
    .cost-bar-fill.high { background: #ef4444; }
    .warning-box {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid #ef4444;
      color: #fca5a5;
      padding: 12px 16px;
      border-radius: 6px;
      margin-top: 10px;
      font-size: 13px;
    }
    .success-box {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid #10b981;
      color: #6ee7b7;
      padding: 12px 16px;
      border-radius: 6px;
      margin-top: 10px;
      font-size: 13px;
    }
    .sql-suggest {
      background: #1e1e1e;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 6px 10px;
      font-family: monospace;
      color: #fcd34d;
      margin-top: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>
  <div class="top-header">
    <h2>⚡ ${ru ? 'Визуализатор Плана Запроса (EXPLAIN)' : 'Execution Plan Visualizer'}: ${connectionName}</h2>
    <div class="controls">
      <span class="badge badge-db">${dbType}</span>
      ${costTimeMs > 0 ? `<span class="badge badge-time">${costTimeMs}ms</span>` : ''}
      <label style="font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
        <input type="checkbox" id="analyzeCheck" ${isAnalyze ? 'checked' : ''} onchange="toggleAnalyze(this.checked)">
        ${ru ? 'Режим ANALYZE (реальное выполнение)' : 'ANALYZE (Actual Run & Time)'}
      </label>
      <button class="secondary" onclick="reExplain()">${ru ? '🔄 Пересчитать' : '🔄 Re-run'}</button>
    </div>
  </div>

  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
      <b>SQL Query:</b>
      <button class="secondary" style="padding: 2px 8px; font-size: 11px;" onclick="copyText(querySql)">${ru ? 'Копировать' : 'Copy'}</button>
    </div>
    <div class="sql-code">${escapedSql}</div>
  </div>

  <div class="card">
    <div class="tabs">
      <button class="tab-btn active" id="btnVisual" onclick="showTab('visual')">🌳 ${ru ? 'Визуальный План' : 'Visual Plan'}</button>
      <button class="tab-btn" id="btnRaw" onclick="showTab('raw')">📄 ${ru ? 'Исходный Вывод (JSON / Text)' : 'Raw Output'}</button>
    </div>

    <div id="visualTab">
      <div id="planTree"></div>
    </div>

    <div id="rawTab" style="display: none;">
      <div style="display: flex; justify-content: flex-end; margin-bottom: 6px;">
        <button class="secondary" style="padding: 2px 10px; font-size: 11px;" onclick="copyRaw()">${ru ? 'Копировать вывод' : 'Copy Output'}</button>
      </div>
      <pre id="rawContent" class="sql-code" style="max-height: 450px;"></pre>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-top:0;">💡 ${ru ? 'Анализ и Советы по Оптимизации' : 'Optimization & Index Advisor'}</h3>
    <div id="insights"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const rows = ${rowsJson};
    const dbType = ${JSON.stringify(dbType)};
    const querySql = ${JSON.stringify(sql)};

    function showTab(tab) {
      document.getElementById('visualTab').style.display = tab === 'visual' ? 'block' : 'none';
      document.getElementById('rawTab').style.display = tab === 'raw' ? 'block' : 'none';
      document.getElementById('btnVisual').className = 'tab-btn' + (tab === 'visual' ? ' active' : '');
      document.getElementById('btnRaw').className = 'tab-btn' + (tab === 'raw' ? ' active' : '');
    }

    function toggleAnalyze(val) {
      vscode.postMessage({ type: 'reExplain', analyze: val });
    }

    function reExplain() {
      const isChecked = document.getElementById('analyzeCheck').checked;
      vscode.postMessage({ type: 'reExplain', analyze: isChecked });
    }

    function copyText(str) {
      navigator.clipboard.writeText(str);
      alert('${ru ? "Скопировано в буфер обмена!" : "Copied to clipboard!"}');
    }

    function copyRaw() {
      const text = document.getElementById('rawContent').textContent;
      copyText(text);
    }

    function formatRawPlan(data) {
      if (!data) return '';
      if (Array.isArray(data) && data.length === 1 && typeof data[0] === 'object' && data[0] !== null) {
        const first = data[0];
        const val = first['EXPLAIN'] || first['explain'] || first['QUERY PLAN'] || first['query plan'];
        if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            return JSON.stringify(parsed, null, 2);
          } catch (e) {
            return val;
          }
        }
      }

      if (Array.isArray(data) && data.length > 0) {
        const isLines = data.every(item => typeof item === 'object' && item !== null && Object.keys(item).length === 1 && typeof Object.values(item)[0] === 'string');
        if (isLines) {
          return data.map(item => Object.values(item)[0]).join(String.fromCharCode(10));
        }
      }

      try {
        const unwrapped = JSON.parse(JSON.stringify(data, (key, value) => {
          if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
            try {
              return JSON.parse(value);
            } catch (e) {
              return value;
            }
          }
          return value;
        }));
        return JSON.stringify(unwrapped, null, 2);
      } catch (e) {
        return JSON.stringify(data, null, 2);
      }
    }

    // Set raw text with clean newlines and indentation
    document.getElementById('rawContent').textContent = formatRawPlan(rows);

    // Build visual plan nodes
    const treeDiv = document.getElementById('planTree');
    const insightsDiv = document.getElementById('insights');

    let totalCost = 1;
    let foundSeqScans = [];
    let foundIndexScans = [];

    function renderNode(node, depth = 0) {
      const el = document.createElement('div');
      el.className = 'plan-node';
      el.style.marginLeft = (depth * 24) + 'px';

      const type = node.nodeType || node.type || 'Step';
      const isScan = /scan|search/i.test(type);
      const isFull = /seq scan|all|scan table/i.test(type) || (node.access_type && node.access_type.toUpperCase() === 'ALL');
      const isIndex = /index/i.test(type) || (node.key && node.key !== 'null');

      if (isFull) {
        el.classList.add('scan-full');
        if (node.relation || node.table) foundSeqScans.push(node.relation || node.table);
      } else if (isIndex) {
        el.classList.add('scan-index');
        if (node.relation || node.table) foundIndexScans.push(node.relation || node.table);
      } else if (/join/i.test(type)) {
        el.classList.add('join-op');
      }

      const header = document.createElement('div');
      header.className = 'node-header';

      const title = document.createElement('div');
      title.className = 'node-title';
      title.textContent = (depth > 0 ? '↳ ' : '') + type + (node.relation ? ' on ' + node.relation : (node.table ? ' on ' + node.table : ''));
      header.appendChild(title);

      const badges = document.createElement('div');
      badges.className = 'node-badges';
      if (isFull) {
        badges.innerHTML += '<span class="badge scan-badge-danger">${ru ? "ПОЛНОЕ СКАНИРОВАНИЕ" : "FULL TABLE SCAN"}</span>';
      } else if (isIndex) {
        badges.innerHTML += '<span class="badge scan-badge-success">${ru ? "ИНДЕКС" : "INDEX LOOKUP"}</span>';
      }
      header.appendChild(badges);
      el.appendChild(header);

      const metrics = document.createElement('div');
      metrics.className = 'node-metrics';
      if (node.cost !== undefined) metrics.innerHTML += '<span><b>Cost:</b> ' + node.cost + '</span>';
      if (node.rows !== undefined) metrics.innerHTML += '<span><b>Rows:</b> ' + Number(node.rows).toLocaleString() + '</span>';
      if (node.actualTime !== undefined) metrics.innerHTML += '<span><b>Time:</b> ' + node.actualTime + 'ms</span>';
      if (node.loops !== undefined) metrics.innerHTML += '<span><b>Loops:</b> ' + node.loops + '</span>';
      if (node.filter) metrics.innerHTML += '<span><b>Filter:</b> ' + node.filter + '</span>';
      el.appendChild(metrics);

      if (node.cost !== undefined && totalCost > 0) {
        const pct = Math.min(100, Math.max(2, Math.round((node.cost / totalCost) * 100)));
        const barWrap = document.createElement('div');
        barWrap.className = 'cost-bar-container';
        const fill = document.createElement('div');
        fill.className = 'cost-bar-fill' + (pct > 60 ? ' high' : '');
        fill.style.width = pct + '%';
        barWrap.appendChild(fill);
        el.appendChild(barWrap);
      }

      treeDiv.appendChild(el);

      if (Array.isArray(node.children)) {
        node.children.forEach(ch => renderNode(ch, depth + 1));
      }
    }

    // Normalise plan tree across engines
    try {
      let rootNodes = [];

      // PostgreSQL JSON Plan
      if (Array.isArray(rows) && rows[0] && rows[0]['QUERY PLAN']) {
        const p = rows[0]['QUERY PLAN'][0]?.Plan;
        if (p) {
          totalCost = p['Total Cost'] || 1;
          function mapPg(n) {
            return {
              nodeType: n['Node Type'],
              relation: n['Relation Name'],
              cost: n['Total Cost'],
              rows: n['Plan Rows'],
              actualTime: n['Actual Total Time'],
              loops: n['Actual Loops'],
              filter: n['Filter'],
              children: (n['Plans'] || []).map(mapPg),
            };
          }
          rootNodes.push(mapPg(p));
        }
      } else if (Array.isArray(rows) && rows[0] && rows[0]['EXPLAIN']) {
        // MySQL JSON Plan
        try {
          const qb = JSON.parse(rows[0]['EXPLAIN'])?.query_block;
          if (qb) {
            const tbl = qb.table || {};
            rootNodes.push({
              nodeType: (tbl.access_type ? tbl.access_type.toUpperCase() : 'Table Scan'),
              table: tbl.table_name,
              rows: tbl.rows_examined_per_scan,
              cost: tbl.cost_info?.query_cost,
              children: [],
            });
          }
        } catch (e) {}
      } else if (Array.isArray(rows) && rows[0] && rows[0].detail !== undefined) {
        // SQLite EXPLAIN QUERY PLAN
        rows.forEach(r => {
          rootNodes.push({
            nodeType: r.detail,
            cost: undefined,
            rows: undefined,
            children: [],
          });
        });
      }

      if (rootNodes.length > 0) {
        rootNodes.forEach(rn => renderNode(rn, 0));
      } else {
        // Fallback text rows
        rows.forEach(r => {
          const textLine = typeof r === 'string' ? r : Object.values(r).join(' | ');
          const el = document.createElement('div');
          el.className = 'plan-node';
          el.textContent = textLine;
          if (/seq scan|scan table|all/i.test(textLine)) {
            el.classList.add('scan-full');
            foundSeqScans.push('table');
          } else if (/index/i.test(textLine)) {
            el.classList.add('scan-index');
            foundIndexScans.push('table');
          }
          treeDiv.appendChild(el);
        });
      }
    } catch (e) {
      treeDiv.innerHTML = '<div style="color:#ef4444;">Error rendering visual plan: ' + e.message + '</div>';
    }

    // Generate smart recommendations
    let insightsHtml = '';
    if (foundSeqScans.length > 0) {
      const tables = Array.from(new Set(foundSeqScans)).join(', ');
      insightsHtml += '<div class="warning-box">';
      insightsHtml += '⚠️ <b>${ru ? "Обнаружено полное сканирование таблицы (Full Table Scan)" : "Full Table Scan Detected"}:</b> ' + tables + '<br>';
      insightsHtml += '${ru ? "Запрос перебирает все строки таблицы без использования индексов. Это замедляет выборку на больших объёмах данных." : "The query scans all rows without utilizing index structures, which significantly slows down execution on large tables."}';
      
      // Auto-generate suggested index SQL
      const matchWhere = querySql.match(/WHERE\\s+([a-zA-Z0-9_.]+)/i);
      if (matchWhere && matchWhere[1]) {
        const col = matchWhere[1].split('.').pop();
        const tbl = foundSeqScans[0] !== 'table' ? foundSeqScans[0] : 'table_name';
        const indexSql = 'CREATE INDEX idx_' + tbl + '_' + col + ' ON ' + tbl + ' (' + col + ');';
        insightsHtml += '<div style="margin-top:8px;"><b>${ru ? "Рекомендация по индексу" : "Suggested Index"}:</b></div>';
        insightsHtml += '<div class="sql-suggest"><span>' + indexSql + '</span><button class="secondary" style="padding:2px 8px; font-size:11px;" onclick="copyText(\\'' + indexSql + '\\')">${ru ? "Копировать" : "Copy"}</button></div>';
      }
      insightsHtml += '</div>';
    } else {
      insightsHtml += '<div class="success-box">✅ <b>${ru ? "Отличный план запроса!" : "Optimal Query Plan!"}</b><br>${ru ? "Все операции чтения используют эффективные индексные пути." : "All table lookups utilize efficient index pathways."}</div>';
    }

    insightsDiv.innerHTML = insightsHtml;
  </script>
</body>
</html>`;
  }
}
