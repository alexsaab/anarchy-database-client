import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { QueryResult } from '../model/QueryTypes.js';
import { t } from '../util/i18n.js';

export interface SqlStatement {
  sql: string;
  /** 1-based line in the source file where this statement starts. */
  line: number;
}

export interface StatementOutcome {
  statement: SqlStatement;
  ok: boolean;
  rowCount?: number;
  affectedRows?: number;
  costTimeMs?: number;
  error?: string;
}

export class SqlScriptRunner {
  private static channel: vscode.OutputChannel | undefined;

  private static log(): vscode.OutputChannel {
    if (!SqlScriptRunner.channel) {
      SqlScriptRunner.channel = vscode.window.createOutputChannel('Anarchy DB: SQL Script');
    }
    return SqlScriptRunner.channel;
  }

  /**
   * Splits a script into statements on semicolons, ignoring any that sit inside
   * a string, an identifier quote, a comment, or a PostgreSQL dollar-quoted
   * block. Honours MySQL's DELIMITER directive so dumps with routines survive.
   */
  public static split(script: string): SqlStatement[] {
    const statements: SqlStatement[] = [];
    let delimiter = ';';
    let buffer = '';
    let line = 1;
    let startLine = 1;

    const push = () => {
      const sql = buffer.trim();
      // A statement may open with comments; only skip chunks that are nothing
      // but comments. This strip is used for the keep/drop test only -- the
      // statement is executed verbatim.
      const withoutComments = sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|\n)[ \t]*(--|#)[^\n]*/g, '$1')
        .trim();
      if (withoutComments) {
        statements.push({ sql, line: startLine });
      }
      buffer = '';
      startLine = line;
    };

    let i = 0;
    while (i < script.length) {
      const ch = script[i];
      const rest = script.slice(i);

      if (ch === '\n') {
        line++;
        buffer += ch;
        i++;
        if (!buffer.trim()) {
          startLine = line;
        }
        continue;
      }

      // MySQL DELIMITER directive (only meaningful at the start of a line).
      const delimMatch = /^DELIMITER[ \t]+(\S+)[ \t]*/i.exec(rest);
      if (delimMatch && (i === 0 || script[i - 1] === '\n')) {
        push();
        delimiter = delimMatch[1];
        i += delimMatch[0].length;
        continue;
      }

      // Line comments run to end of line.
      if (rest.startsWith('--') || ch === '#') {
        const end = script.indexOf('\n', i);
        const stop = end === -1 ? script.length : end;
        buffer += script.slice(i, stop);
        i = stop;
        continue;
      }

      // Block comments.
      if (rest.startsWith('/*')) {
        const end = script.indexOf('*/', i + 2);
        const stop = end === -1 ? script.length : end + 2;
        const chunk = script.slice(i, stop);
        line += (chunk.match(/\n/g) || []).length;
        buffer += chunk;
        i = stop;
        continue;
      }

      // Quoted string or quoted identifier.
      if (ch === "'" || ch === '"' || ch === '`') {
        let j = i + 1;
        while (j < script.length) {
          if (script[j] === '\\' && ch !== '`') {
            j += 2;
            continue;
          }
          if (script[j] === ch) {
            // A doubled quote is an escaped quote, not a terminator.
            if (script[j + 1] === ch) {
              j += 2;
              continue;
            }
            j++;
            break;
          }
          j++;
        }
        const chunk = script.slice(i, j);
        line += (chunk.match(/\n/g) || []).length;
        buffer += chunk;
        i = j;
        continue;
      }

      // Statement terminator.
      if (script.startsWith(delimiter, i)) {
        push();
        i += delimiter.length;
        continue;
      }

      // Dollar-quoted string: $$ ... $$ or $tag$ ... $tag$ (PostgreSQL).
      const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
      if (dollar) {
        const tag = dollar[0];
        const end = script.indexOf(tag, i + tag.length);
        const stop = end === -1 ? script.length : end + tag.length;
        const chunk = script.slice(i, stop);
        line += (chunk.match(/\n/g) || []).length;
        buffer += chunk;
        i = stop;
        continue;
      }

      buffer += ch;
      i++;
    }

    push();
    return statements;
  }

  public static async runFile(
    filePath: string,
    connectionConfig: ConnectionConfig,
    password?: string,
    sshPassword?: string
  ): Promise<void> {
    let script: string;
    try {
      script = fs.readFileSync(filePath, 'utf8');
    } catch (e: any) {
      vscode.window.showErrorMessage(`Could not read ${filePath}: ${e.message}`);
      return;
    }

    const statements = SqlScriptRunner.split(script);
    const fileName = path.basename(filePath);

    if (statements.length === 0) {
      vscode.window.showWarningMessage(t(`${fileName} contains no SQL statements.`, `В ${fileName} нет SQL-запросов.`));
      return;
    }

    const target = `${connectionConfig.name}${connectionConfig.database ? ` / ${connectionConfig.database}` : ''}`;
    const run = t('Run', 'Выполнить');
    const confirm = await vscode.window.showWarningMessage(
      t(
        `Run ${statements.length} statement(s) from "${fileName}" against ${target}?`,
        `Выполнить ${statements.length} запрос(ов) из "${fileName}" в ${target}?`
      ),
      { modal: true },
      run
    );
    if (confirm !== run) {
      return;
    }

    const log = SqlScriptRunner.log();
    log.show(true);
    log.appendLine(`\n=== ${fileName} -> ${target} : ${statements.length} statement(s) ===`);

    const outcomes: StatementOutcome[] = [];
    let lastRowResult: { statement: SqlStatement; result: QueryResult } | undefined;
    let aborted = false;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t(`Running ${fileName}`, `Выполнение ${fileName}`),
        cancellable: true,
      },
      async (progress, token) => {
        const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);

        for (let index = 0; index < statements.length; index++) {
          if (token.isCancellationRequested) {
            aborted = true;
            log.appendLine('-- cancelled by user');
            break;
          }

          const statement = statements[index];
          progress.report({
            message: `${index + 1}/${statements.length} (line ${statement.line})`,
            increment: 100 / statements.length,
          });

          const preview = statement.sql.replace(/\s+/g, ' ').slice(0, 120);
          try {
            const result = await driver.executeQuery(statement.sql);
            const rowCount = result.rows ? result.rows.length : 0;
            outcomes.push({
              statement,
              ok: true,
              rowCount,
              affectedRows: result.affectedRows,
              costTimeMs: result.costTimeMs,
            });
            if (rowCount > 0 || (result.fields && result.fields.length > 0)) {
              lastRowResult = { statement, result };
            }
            log.appendLine(
              `[${index + 1}/${statements.length}] line ${statement.line}  OK  ` +
                `${rowCount} row(s), ${result.affectedRows ?? 0} affected, ${result.costTimeMs}ms  |  ${preview}`
            );
          } catch (err: any) {
            const message = err?.message || String(err);
            outcomes.push({ statement, ok: false, error: message });
            log.appendLine(`[${index + 1}/${statements.length}] line ${statement.line}  FAILED  ${message}`);
            log.appendLine(`    ${preview}`);

            const keepGoing = t('Continue', 'Продолжить');
            const stop = t('Stop', 'Остановить');
            const answer = await vscode.window.showErrorMessage(
              t(
                `Statement ${index + 1} (line ${statement.line}) failed: ${message}`,
                `Запрос ${index + 1} (строка ${statement.line}) не выполнен: ${message}`
              ),
              keepGoing,
              stop
            );
            if (answer !== keepGoing) {
              aborted = true;
              break;
            }
          }
        }
      }
    );

    const ok = outcomes.filter((o) => o.ok).length;
    const failed = outcomes.filter((o) => !o.ok).length;
    const totalMs = outcomes.reduce((sum, o) => sum + (o.costTimeMs || 0), 0);
    log.appendLine(
      `=== done: ${ok} succeeded, ${failed} failed, ${statements.length - outcomes.length} not run, ${totalMs}ms ===`
    );

    const summary = t(
      `${fileName}: ${ok} succeeded, ${failed} failed${aborted ? ', stopped early' : ''} (${totalMs}ms)`,
      `${fileName}: успешно ${ok}, с ошибкой ${failed}${aborted ? ', остановлено' : ''} (${totalMs}мс)`
    );

    if (failed > 0) {
      vscode.window.showWarningMessage(summary);
    } else {
      vscode.window.showInformationMessage(summary);
    }

    return lastRowResult
      ? SqlScriptRunner.showRows(connectionConfig, password, sshPassword, lastRowResult)
      : undefined;
  }

  private static async showRows(
    connectionConfig: ConnectionConfig,
    password: string | undefined,
    sshPassword: string | undefined,
    last: { statement: SqlStatement; result: QueryResult }
  ): Promise<void> {
    const { TableWebviewProvider } = await import('../webview/TableWebviewProvider.js');
    TableWebviewProvider.openQueryConsole(connectionConfig, password, sshPassword, {
      initialSql: last.statement.sql,
      initialResult: last.result,
    });
  }
}
