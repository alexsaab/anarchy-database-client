import * as vscode from 'vscode';
import http from 'http';
import https from 'https';
import { isRussian, t } from '../util/i18n.js';

export interface AiResponse {
  sql: string;
  explanation: string;
  provider: string;
}

export class AiService {
  /**
   * Generates a SQL statement from a natural language prompt given schema metadata and DBMS dialect.
   */
  public static async generateSql(
    prompt: string,
    schemaSummary: string,
    dbType: string = 'PostgreSQL',
    customApiKey?: string,
    ollamaEndpoint?: string
  ): Promise<AiResponse> {
    // 1. Try VS Code Language Model API (GitHub Copilot / VS Code 1.85+) if available
    try {
      if ((vscode as any).lm && typeof (vscode as any).lm.selectChatModels === 'function') {
        const models = await (vscode as any).lm.selectChatModels({ family: 'gpt-4o' });
        if (models && models.length > 0) {
          const model = models[0];
          const systemPrompt = `You are an expert SQL engineer. Generate a single valid ${dbType} SQL query for the user request based on the schema below.\n\nSchema:\n${schemaSummary}\n\nReturn your answer formatted strictly as JSON with keys "sql" and "explanation". Do not include markdown ticks outside the JSON.`;
          const messages = [
            (vscode as any).LanguageModelChatMessage.User(`${systemPrompt}\n\nUser Request: ${prompt}`)
          ];
          const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
          let responseText = '';
          for await (const chunk of response.text) {
            responseText += chunk;
          }
          const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
          try {
            const parsed = JSON.parse(cleanJson);
            if (parsed.sql) {
              return {
                sql: parsed.sql,
                explanation: parsed.explanation || 'Generated using VS Code Language Model API',
                provider: model.name || 'VS Code LM',
              };
            }
          } catch {
            return {
              sql: cleanJson,
              explanation: 'Generated via Copilot Language Model',
              provider: 'VS Code LM',
            };
          }
        }
      }
    } catch {
      // VS Code LM not active or rejected
    }

    // 2. Try Ollama local endpoint if accessible
    if (ollamaEndpoint) {
      try {
        const ollamaRes = await AiService.callOllama(ollamaEndpoint, prompt, schemaSummary, dbType);
        if (ollamaRes) return ollamaRes;
      } catch {
        // Ollama offline
      }
    }

    // 3. Smart Schema-Aware Heuristic Generator (Offline fallback)
    return AiService.generateHeuristicSql(prompt, schemaSummary, dbType);
  }

  /**
   * Explains a query in plain human-readable terms.
   */
  public static explainQuery(sql: string, dbType: string = 'SQL'): string {
    const ru = isRussian();
    const clean = sql.trim().toUpperCase();

    if (clean.startsWith('SELECT')) {
      const fromMatch = sql.match(/FROM\s+([a-zA-Z0-9_."`]+)/i);
      const target = fromMatch ? fromMatch[1] : 'table';
      const hasWhere = /WHERE/i.test(sql);
      const hasJoin = /JOIN/i.test(sql);
      const hasGroup = /GROUP\s+BY/i.test(sql);

      if (ru) {
        let desc = `Запрос выполняет чтение данных из таблицы \`${target}\`.`;
        if (hasJoin) desc += ' Объединяет связанные таблицы через JOIN.';
        if (hasWhere) desc += ' Фильтрует строки по указанным критериям в блоке WHERE.';
        if (hasGroup) desc += ' Группирует данные и рассчитывает агрегатные показатели.';
        return desc;
      } else {
        let desc = `This query retrieves data from \`${target}\`.`;
        if (hasJoin) desc += ' Joins related tables.';
        if (hasWhere) desc += ' Filters rows based on WHERE condition.';
        if (hasGroup) desc += ' Groups records to calculate aggregate values.';
        return desc;
      }
    }

    if (clean.startsWith('INSERT')) {
      return ru ? 'Запрос вставляет новые записи в таблицу.' : 'Query inserts new records into the table.';
    }
    if (clean.startsWith('UPDATE')) {
      return ru ? 'Запрос обновляет существующие записи в таблице.' : 'Query updates existing rows in the table.';
    }
    if (clean.startsWith('DELETE')) {
      return ru ? 'Запрос удаляет записи из таблицы.' : 'Query deletes records from the table.';
    }

    return ru ? 'Пользовательский SQL запрос.' : 'Custom SQL query.';
  }

  /**
   * Smart schema-aware offline SQL generator based on tokens in the natural language prompt and real schema.
   */
  public static generateHeuristicSql(prompt: string, schemaSummary: string, dbType: string): AiResponse {
    const ru = isRussian();
    const p = prompt.toLowerCase();

    // Extract table names mentioned or present in schemaSummary
    const schemaLines = schemaSummary.split('\n');
    const tableNames: string[] = [];
    for (const line of schemaLines) {
      const match = line.match(/Table\s+([a-zA-Z0-9_]+):/i);
      if (match) tableNames.push(match[1]);
    }

    // Match table by name or common domain synonyms
    let targetTable: string | undefined;
    for (const tbl of tableNames) {
      const tLow = tbl.toLowerCase();
      if (p.includes(tLow)) {
        targetTable = tbl;
        break;
      }
      if ((tLow.includes('user') || tLow.includes('customer')) && (p.includes('пользоват') || p.includes('клиент') || p.includes('user') || p.includes('customer'))) {
        targetTable = tbl;
        break;
      }
      if ((tLow.includes('order') || tLow.includes('sale')) && (p.includes('заказ') || p.includes('покупк') || p.includes('продаж') || p.includes('order'))) {
        targetTable = tbl;
        break;
      }
      if ((tLow.includes('product') || tLow.includes('item')) && (p.includes('товар') || p.includes('продукт') || p.includes('product'))) {
        targetTable = tbl;
        break;
      }
    }

    if (!targetTable) {
      targetTable = tableNames[0] || 'users';
    }

    const isCount = p.includes('сколько') || p.includes('count') || p.includes('число') || p.includes('количество');
    const isTop = p.includes('топ') || p.includes('top') || p.includes('первые') || p.includes('first');
    const isSum = p.includes('сумма') || p.includes('sum') || p.includes('общ') || p.includes('total');
    const isRecent = p.includes('последн') || p.includes('свеж') || p.includes('recent') || p.includes('last') || p.includes('new');

    let sql = '';
    let explanation = '';

    if (isCount) {
      sql = `SELECT COUNT(*) AS total_count\nFROM ${targetTable};`;
      explanation = ru
        ? `Подсчёт общего количества записей в таблице "${targetTable}".`
        : `Counts total number of rows in "${targetTable}".`;
    } else if (isSum) {
      sql = `SELECT SUM(amount) AS total_sum\nFROM ${targetTable};`;
      explanation = ru
        ? `Суммирование числовых значений в таблице "${targetTable}".`
        : `Calculates sum of values in "${targetTable}".`;
    } else if (isRecent || isTop) {
      sql = `SELECT *\nFROM ${targetTable}\nORDER BY 1 DESC\nLIMIT 20;`;
      explanation = ru
        ? `Выборка 20 последних записей из "${targetTable}", отсортированных по убыванию идентификатора/даты.`
        : `Fetches top 20 recent rows from "${targetTable}" sorted in descending order.`;
    } else {
      sql = `SELECT *\nFROM ${targetTable}\nLIMIT 50;`;
      explanation = ru
        ? `Базовая выборка первых 50 строк из таблицы "${targetTable}".`
        : `Basic selection of first 50 rows from "${targetTable}".`;
    }

    return {
      sql,
      explanation,
      provider: 'Built-in Schema Engine',
    };
  }

  private static async callOllama(
    endpoint: string,
    prompt: string,
    schemaSummary: string,
    dbType: string
  ): Promise<AiResponse | null> {
    return new Promise((resolve) => {
      const url = new URL(endpoint.endsWith('/generate') ? endpoint : `${endpoint}/api/generate`);
      const body = JSON.stringify({
        model: 'codellama',
        prompt: `Generate ${dbType} SQL query for: ${prompt}\n\nSchema:\n${schemaSummary}\n\nOnly output SQL:`,
        stream: false,
      });

      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 4000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.response) {
                resolve({
                  sql: parsed.response.trim(),
                  explanation: 'Generated with Local Ollama LLM',
                  provider: 'Ollama',
                });
                return;
              }
            } catch {}
            resolve(null);
          });
        }
      );

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(body);
      req.end();
    });
  }
}
