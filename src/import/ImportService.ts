import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo } from '../model/QueryTypes.js';
import { RowWriter, formatTableRef, runBound } from '../sql/RowWriter.js';
import { t } from '../util/i18n.js';

/** Rows sent per transaction-ish chunk, and how often progress is reported. */
const CHUNK = 200;

export interface ParsedSheet {
  headers: string[];
  rows: any[][];
}

export class ImportService {
  /**
   * Splits one CSV line, honouring quoted fields, doubled quotes inside them and
   * separators that appear within quotes.
   */
  public static parseCsvLine(line: string, delimiter = ','): string[] {
    const out: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        out.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    out.push(field);
    return out;
  }

  /** Guesses the delimiter from the header line: comma, semicolon or tab. */
  public static detectDelimiter(headerLine: string): string {
    const candidates = [',', ';', '\t'];
    let best = ',';
    let bestCount = -1;
    for (const c of candidates) {
      const count = ImportService.parseCsvLine(headerLine, c).length;
      if (count > bestCount) {
        bestCount = count;
        best = c;
      }
    }
    return best;
  }

  public static parseCsv(text: string): ParsedSheet {
    // Split on newlines that are not inside quotes.
    const lines: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') {
          current += '""';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        current += ch;
        continue;
      }
      if (!inQuotes && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && text[i + 1] === '\n') {
          i++;
        }
        lines.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.length > 0) {
      lines.push(current);
    }

    const nonEmpty = lines.filter((l) => l.trim() !== '');
    if (nonEmpty.length === 0) {
      return { headers: [], rows: [] };
    }

    const delimiter = ImportService.detectDelimiter(nonEmpty[0]);
    const headers = ImportService.parseCsvLine(nonEmpty[0], delimiter).map((h) => h.trim());
    const rows = nonEmpty.slice(1).map((l) => ImportService.parseCsvLine(l, delimiter));
    return { headers, rows };
  }

  public static async parseXlsx(filePath: string): Promise<ParsedSheet> {
    let ExcelJS: any;
    try {
      ExcelJS = require('exceljs');
    } catch (e: any) {
      throw new Error(`Excel support is unavailable: ${e?.message || e}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return { headers: [], rows: [] };
    }

    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell: any, col: number) => {
      headers[col - 1] = ImportService.cellText(cell.value);
    });

    const rows: any[][] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const values: any[] = [];
      let empty = true;
      for (let c = 1; c <= headers.length; c++) {
        const raw = row.getCell(c).value;
        const value = ImportService.cellValue(raw);
        values[c - 1] = value;
        if (value !== null && value !== '') {
          empty = false;
        }
      }
      if (!empty) {
        rows.push(values);
      }
    }

    return { headers: headers.map((h) => String(h ?? '').trim()), rows };
  }

  private static cellText(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object' && 'richText' in value) {
      return value.richText.map((p: any) => p.text).join('');
    }
    if (typeof value === 'object' && 'text' in value) {
      return String(value.text);
    }
    return String(value);
  }

  /** Unwraps the shapes ExcelJS uses for formulas, hyperlinks and rich text. */
  private static cellValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'object') {
      if ('result' in value) {
        return value.result ?? null;
      }
      if ('text' in value) {
        return value.text;
      }
      if ('richText' in value) {
        return value.richText.map((p: any) => p.text).join('');
      }
      return JSON.stringify(value);
    }
    return value;
  }

  /**
   * Coerces a spreadsheet value to something the column can accept. Empty cells
   * become NULL rather than empty strings, which would fail a numeric column.
   */
  public static coerce(value: any, column?: ColumnInfo): any {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const type = String(column?.type || '').toUpperCase();

    if (/INT|SERIAL|DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT|MONEY/.test(type) && typeof value === 'string') {
      const cleaned = value.trim().replace(/\s/g, '').replace(',', '.');
      const num = Number(cleaned);
      return Number.isFinite(num) ? num : value;
    }

    if (/BOOL/.test(type) && typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (['true', 't', 'yes', 'y', '1'].includes(v)) {
        return true;
      }
      if (['false', 'f', 'no', 'n', '0'].includes(v)) {
        return false;
      }
    }

    if (value instanceof Date && /DATE|TIME/.test(type)) {
      return value.toISOString();
    }

    return value;
  }

  public static async importIntoTable(
    tableName: string,
    connectionConfig: ConnectionConfig,
    password?: string,
    sshPassword?: string,
    schemaName?: string
  ): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: t('Import', 'Импортировать'),
      filters: { [t('Data files', 'Файлы данных')]: ['csv', 'tsv', 'txt', 'xlsx'] },
    });
    if (!picked || picked.length === 0) {
      return;
    }
    const filePath = picked[0].fsPath;

    try {
      const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);

      if (!driver.supportsSqlWrites) {
        vscode.window.showWarningMessage(
          t(
            `Import is only available for SQL databases, not ${connectionConfig.type}.`,
            `Импорт доступен только для SQL-баз, не для ${connectionConfig.type}.`
          )
        );
        return;
      }

      const sheet = filePath.toLowerCase().endsWith('.xlsx')
        ? await ImportService.parseXlsx(filePath)
        : ImportService.parseCsv(fs.readFileSync(filePath, 'utf8'));

      if (sheet.headers.length === 0 || sheet.rows.length === 0) {
        vscode.window.showWarningMessage(
          t(`${path.basename(filePath)} has no data rows.`, `В ${path.basename(filePath)} нет строк данных.`)
        );
        return;
      }

      const columns = await driver.getColumns(tableName, connectionConfig.database, schemaName);
      const columnNames = columns.map((c) => c.name);

      // Map each file column onto a table column, defaulting to an exact or
      // case-insensitive name match and letting the user correct it.
      const mapping: { header: string; index: number; column: ColumnInfo }[] = [];
      const unmatched: string[] = [];

      for (let i = 0; i < sheet.headers.length; i++) {
        const header = sheet.headers[i];
        if (!header) {
          continue;
        }
        const match =
          columns.find((c) => c.name === header) ||
          columns.find((c) => c.name.toLowerCase() === header.toLowerCase());
        if (match) {
          mapping.push({ header, index: i, column: match });
        } else {
          unmatched.push(header);
        }
      }

      if (mapping.length === 0) {
        vscode.window.showErrorMessage(
          t(
            `None of the file's columns (${sheet.headers.join(', ')}) match "${tableName}" (${columnNames.join(', ')}).`,
            `Ни одна колонка файла (${sheet.headers.join(', ')}) не совпадает с "${tableName}" (${columnNames.join(', ')}).`
          )
        );
        return;
      }

      const summary = mapping.map((m) => `${m.header} → ${m.column.name}`).join(', ');
      const proceed = t(`Import ${sheet.rows.length} rows`, `Импортировать ${sheet.rows.length} строк`);
      const choose = t('Choose columns...', 'Выбрать колонки...');
      const answer = await vscode.window.showInformationMessage(
        t(
          `Mapping: ${summary}${unmatched.length ? `. Ignored: ${unmatched.join(', ')}` : ''}`,
          `Соответствие: ${summary}${unmatched.length ? `. Пропущено: ${unmatched.join(', ')}` : ''}`
        ),
        { modal: true },
        proceed,
        choose
      );
      if (!answer) {
        return;
      }

      let selected = mapping;
      if (answer === choose) {
        const chosen = await vscode.window.showQuickPick(
          mapping.map((m) => ({ label: `${m.header} → ${m.column.name}`, picked: true, m })),
          { canPickMany: true, title: t('Columns to import', 'Колонки для импорта') }
        );
        if (!chosen || chosen.length === 0) {
          return;
        }
        selected = chosen.map((c) => c.m);
      }

      const tableRef = formatTableRef(connectionConfig.type, tableName, schemaName, connectionConfig.database);
      let inserted = 0;
      const failures: string[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t(`Importing into ${tableName}...`, `Импорт в ${tableName}...`),
          cancellable: true,
        },
        async (progress, token) => {
          for (let i = 0; i < sheet.rows.length; i++) {
            if (token.isCancellationRequested) {
              break;
            }

            const row = sheet.rows[i];
            const data: Record<string, any> = {};
            for (const m of selected) {
              data[m.column.name] = ImportService.coerce(row[m.index], m.column);
            }

            try {
              const writer = new RowWriter(driver, connectionConfig.type, tableRef);
              await runBound(driver, writer.insert(data));
              inserted++;
            } catch (e: any) {
              // Row 1 is the header, so the file's line number is i + 2.
              failures.push(`line ${i + 2}: ${e.message}`);
              if (failures.length > 20) {
                throw new Error(
                  t(
                    `Stopped after 20 failures. First: ${failures[0]}`,
                    `Остановлено после 20 ошибок. Первая: ${failures[0]}`
                  )
                );
              }
            }

            if (i % CHUNK === 0) {
              progress.report({
                message: `${i}/${sheet.rows.length}`,
                increment: (CHUNK / sheet.rows.length) * 100,
              });
            }
          }
        }
      );

      if (failures.length > 0) {
        const channel = vscode.window.createOutputChannel('Anarchy DB: Import');
        channel.appendLine(`Import of ${path.basename(filePath)} into ${tableName}`);
        failures.forEach((f) => channel.appendLine(f));
        channel.show(true);
        vscode.window.showWarningMessage(
          t(
            `Imported ${inserted} of ${sheet.rows.length} rows; ${failures.length} failed (see output).`,
            `Импортировано ${inserted} из ${sheet.rows.length}; с ошибкой ${failures.length} (см. вывод).`
          )
        );
      } else {
        vscode.window.showInformationMessage(
          t(`Imported ${inserted} rows into ${tableName}.`, `Импортировано строк: ${inserted} в ${tableName}.`)
        );
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Import failed: ${err.message}`);
    }
  }
}
