import * as vscode from 'vscode';
import * as fs from 'fs';
import { ColumnInfo, QueryResult } from '../model/QueryTypes.js';
import { t } from '../util/i18n.js';

export type ExportFormat = 'csv' | 'json' | 'sql' | 'xlsx';

/** Excel's hard limits; exceeding either corrupts the workbook. */
const EXCEL_MAX_ROWS = 1048576;
const EXCEL_MAX_CELL_CHARS = 32767;

/** Rows fetched per round trip when exporting a whole table. */
const PAGE_SIZE = 2000;

/** Supplies successive pages of a full-table export. */
export type PageFetcher = (page: number, pageSize: number) => Promise<QueryResult>;

export interface FullExportSource {
  fetchPage: PageFetcher;
  totalCount: number;
}

export class ExportService {
  public static async exportData(
    tableName: string,
    result: QueryResult,
    format: ExportFormat,
    fullSource?: FullExportSource
  ) {
    const pageRows = result.rows ? result.rows.length : 0;
    let source: FullExportSource | undefined;

    // Exporting only what happens to be on screen surprises people, so when the
    // table has more rows than the current page, ask which they meant.
    if (fullSource && fullSource.totalCount > pageRows) {
      const everything = t(`All ${fullSource.totalCount} rows`, `Все строки (${fullSource.totalCount})`);
      const thisPage = t(`This page only (${pageRows} rows)`, `Только эта страница (${pageRows})`);
      const answer = await vscode.window.showQuickPick([everything, thisPage], {
        title: t('How much should be exported?', 'Что экспортировать?'),
        placeHolder: t('Choose the scope of the export', 'Выберите объём экспорта'),
      });
      if (!answer) {
        return;
      }
      if (answer === everything) {
        source = fullSource;
      }
    }

    const filterName = format === 'xlsx' ? 'Excel Workbook' : format.toUpperCase();
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${tableName}_export.${format}`),
      filters: { [filterName]: [format] },
    });
    if (!uri) {
      return;
    }

    const fields = ExportService.resolveFields(result);

    try {
      if (source) {
        await ExportService.exportStreamed(tableName, fields, format, uri.fsPath, source);
      } else {
        await ExportService.exportSinglePage(tableName, fields, result.rows || [], format, uri.fsPath);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Export failed: ${err.message}`);
    }
  }

  private static resolveFields(result: QueryResult): ColumnInfo[] {
    if (result.fields && result.fields.length > 0) {
      return result.fields;
    }
    return Object.keys((result.rows || [])[0] || {}).map((name) => ({ name, type: 'TEXT', nullable: true }));
  }

  // --- formatting helpers -------------------------------------------------

  private static csvCell(value: any): string {
    if (value === null || value === undefined) {
      return '""';
    }
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  private static sqlLiteral(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private static csvRow(fields: ColumnInfo[], row: any): string {
    return fields.map((f) => ExportService.csvCell(row[f.name])).join(',');
  }

  private static insertRow(tableName: string, fields: ColumnInfo[], row: any): string {
    const cols = fields.map((f) => `"${f.name}"`).join(', ');
    const values = fields.map((f) => ExportService.sqlLiteral(row[f.name])).join(', ');
    return `INSERT INTO "${tableName}" (${cols}) VALUES (${values});`;
  }

  /** 1 -> A, 27 -> AA: Excel's column naming. */
  private static columnLetter(index: number): string {
    let n = index;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out || 'A';
  }

  /** Excel forbids []:*?/\\ in sheet names and caps them at 31 characters. */
  private static sheetName(tableName: string): string {
    const cleaned = String(tableName || 'Sheet1').replace(/[\[\]:*?/\\]/g, '_').trim();
    return cleaned.slice(0, 31) || 'Sheet1';
  }

  /**
   * Maps a driver value onto something Excel stores natively, so numbers sort as
   * numbers and dates render as dates instead of text.
   */
  private static cellValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'bigint') {
      // Beyond 2^53 a number would lose digits, so keep the exact text.
      return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(value)
        : value.toString();
    }
    if (Buffer.isBuffer(value)) {
      return value.toString('hex');
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (e) {
        return String(value);
      }
    }
    const text = String(value);
    return text.length > EXCEL_MAX_CELL_CHARS ? text.slice(0, EXCEL_MAX_CELL_CHARS - 1) + '…' : text;
  }

  // --- single page --------------------------------------------------------

  private static async exportSinglePage(
    tableName: string,
    fields: ColumnInfo[],
    rows: any[],
    format: ExportFormat,
    filePath: string
  ): Promise<void> {
    if (format === 'xlsx') {
      await ExportService.writeWorkbook(tableName, fields, async function* () {
        yield rows;
      }, rows.length, filePath);
      vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${filePath}`);
      return;
    }

    let content = '';
    if (format === 'json') {
      content = JSON.stringify(rows, null, 2);
    } else if (format === 'csv') {
      const header = fields.map((f) => `"${f.name}"`).join(',');
      content = [header, ...rows.map((r) => ExportService.csvRow(fields, r))].join('\n');
    } else {
      content = rows.map((r) => ExportService.insertRow(tableName, fields, r)).join('\n');
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${filePath}`);
  }

  // --- whole table, streamed ---------------------------------------------

  /**
   * Writes the file as pages arrive rather than materialising the whole table,
   * so exporting millions of rows costs one page of memory at a time.
   */
  private static async exportStreamed(
    tableName: string,
    fields: ColumnInfo[],
    format: ExportFormat,
    filePath: string,
    source: FullExportSource
  ): Promise<void> {
    let written = 0;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t(`Exporting ${source.totalCount} rows...`, `Экспорт ${source.totalCount} строк...`),
        cancellable: true,
      },
      async (progress, token) => {
        const pages = async function* () {
          for (let page = 1; ; page++) {
            if (token.isCancellationRequested) {
              return;
            }
            const result = await source.fetchPage(page, PAGE_SIZE);
            const rows = result.rows || [];
            if (rows.length === 0) {
              return;
            }
            written += rows.length;
            progress.report({
              message: `${written}/${source.totalCount}`,
              increment: (rows.length / Math.max(source.totalCount, 1)) * 100,
            });
            yield rows;
            if (rows.length < PAGE_SIZE || written >= source.totalCount) {
              return;
            }
          }
        };

        if (format === 'xlsx') {
          await ExportService.writeWorkbook(tableName, fields, pages, source.totalCount, filePath);
          return;
        }

        const out = fs.createWriteStream(filePath, { encoding: 'utf-8' });
        const write = (chunk: string) =>
          new Promise<void>((resolve, reject) => {
            out.write(chunk, (err) => (err ? reject(err) : resolve()));
          });

        try {
          if (format === 'csv') {
            await write(fields.map((f) => `"${f.name}"`).join(',') + '\n');
          } else if (format === 'json') {
            await write('[\n');
          }

          let first = true;
          for await (const rows of pages()) {
            if (format === 'csv') {
              await write(rows.map((r: any) => ExportService.csvRow(fields, r)).join('\n') + '\n');
            } else if (format === 'json') {
              for (const row of rows) {
                await write((first ? '' : ',\n') + JSON.stringify(row));
                first = false;
              }
            } else {
              await write(rows.map((r: any) => ExportService.insertRow(tableName, fields, r)).join('\n') + '\n');
            }
          }

          if (format === 'json') {
            await write('\n]\n');
          }
        } finally {
          await new Promise<void>((resolve) => out.end(resolve));
        }
      }
    );

    vscode.window.showInformationMessage(
      t(`Exported ${written} rows to ${filePath}`, `Экспортировано строк: ${written} -> ${filePath}`)
    );
  }

  /**
   * Uses ExcelJS's streaming writer so a large export never holds the whole
   * workbook in memory.
   */
  private static async writeWorkbook(
    tableName: string,
    fields: ColumnInfo[],
    pages: () => AsyncGenerator<any[]>,
    expectedRows: number,
    filePath: string
  ): Promise<void> {
    let ExcelJS: any;
    try {
      ExcelJS = require('exceljs');
    } catch (e: any) {
      throw new Error(`Excel export is unavailable: ${e?.message || e}`);
    }

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true });

    // A streaming worksheet is written as it goes, so views and the filter range
    // are creation options -- they cannot be assigned once rows have been sent.
    const lastColumn = ExportService.columnLetter(Math.max(fields.length, 1));
    const sheet = workbook.addWorksheet(ExportService.sheetName(tableName), {
      views: [{ state: 'frozen', ySplit: 1 }],
      autoFilter: `A1:${lastColumn}1`,
    });

    sheet.columns = fields.map((f) => ({
      header: f.name,
      key: f.name,
      width: Math.min(Math.max(f.name.length + 2, 12), 50),
    }));

    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    header.commit();

    let written = 0;
    let truncated = false;

    for await (const rows of pages()) {
      for (const row of rows) {
        if (written >= EXCEL_MAX_ROWS - 1) {
          truncated = true;
          break;
        }
        sheet.addRow(fields.map((f) => ExportService.cellValue(row[f.name]))).commit();
        written++;
      }
      if (truncated) {
        break;
      }
    }

    await sheet.commit();
    await workbook.commit();

    if (truncated) {
      vscode.window.showWarningMessage(
        t(
          `Stopped at Excel's limit of ${EXCEL_MAX_ROWS - 1} rows; ${expectedRows} were requested.`,
          `Достигнут предел Excel в ${EXCEL_MAX_ROWS - 1} строк; запрошено ${expectedRows}.`
        )
      );
    }
  }
}
