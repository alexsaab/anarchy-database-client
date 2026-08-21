import * as vscode from 'vscode';
import * as fs from 'fs';
import { ColumnInfo, QueryResult } from '../model/QueryTypes.js';

export type ExportFormat = 'csv' | 'json' | 'sql' | 'xlsx';

/** Excel's hard limits; exceeding either corrupts the workbook. */
const EXCEL_MAX_ROWS = 1048576;
const EXCEL_MAX_CELL_CHARS = 32767;

export class ExportService {
  public static async exportData(tableName: string, result: QueryResult, format: ExportFormat) {
    const filterName = format === 'xlsx' ? 'Excel Workbook' : format.toUpperCase();
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${tableName}_export.${format}`),
      filters: {
        [filterName]: [format],
      },
    });

    if (!uri) {
      return;
    }

    if (format === 'xlsx') {
      await ExportService.exportXlsx(tableName, result, uri.fsPath);
      return;
    }

    let content = '';

    if (format === 'json') {
      content = JSON.stringify(result.rows, null, 2);
    } else if (format === 'csv') {
      const headers = result.fields.map((f) => `"${f.name}"`).join(',');
      const rows = result.rows.map((r) =>
        result.fields
          .map((f) => {
            const val = r[f.name];
            if (val === null || val === undefined) return '""';
            return `"${String(val).replace(/"/g, '""')}"`;
          })
          .join(',')
      );
      content = [headers, ...rows].join('\n');
    } else if (format === 'sql') {
      const fieldNames = result.fields.map((f) => `"${f.name}"`).join(', ');
      const insertRows = result.rows.map((r) => {
        const values = result.fields
          .map((f) => {
            const val = r[f.name];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return val;
            return `'${String(val).replace(/'/g, "''")}'`;
          })
          .join(', ');
        return `INSERT INTO "${tableName}" (${fieldNames}) VALUES (${values});`;
      });
      content = insertRows.join('\n');
    }

    fs.writeFileSync(uri.fsPath, content, 'utf-8');
    vscode.window.showInformationMessage(`Successfully exported data to ${uri.fsPath}`);
  }

  /** Excel forbids []:*?/\\ in sheet names and caps them at 31 characters. */
  private static sheetName(tableName: string): string {
    const cleaned = String(tableName || 'Sheet1').replace(/[\[\]:*?/\\]/g, '_').trim();
    return (cleaned.slice(0, 31) || 'Sheet1');
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

  private static async exportXlsx(tableName: string, result: QueryResult, filePath: string): Promise<void> {
    let ExcelJS: any;
    try {
      ExcelJS = require('exceljs');
    } catch (e: any) {
      vscode.window.showErrorMessage(`Excel export is unavailable: ${e?.message || e}`);
      return;
    }

    const fields: ColumnInfo[] =
      result.fields && result.fields.length > 0
        ? result.fields
        : Object.keys(result.rows[0] || {}).map((name) => ({ name, type: 'TEXT', nullable: true }));

    let rows = result.rows || [];
    let truncated = false;
    if (rows.length > EXCEL_MAX_ROWS - 1) {
      rows = rows.slice(0, EXCEL_MAX_ROWS - 1);
      truncated = true;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Exporting ${rows.length} rows to Excel...` },
      async () => {
        const workbook = new ExcelJS.Workbook();
        workbook.created = new Date();
        const sheet = workbook.addWorksheet(ExportService.sheetName(tableName));

        sheet.columns = fields.map((f) => ({
          header: f.name,
          key: f.name,
          width: Math.min(Math.max(f.name.length + 2, 12), 50),
        }));

        const header = sheet.getRow(1);
        header.font = { bold: true };
        header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };

        for (const row of rows) {
          sheet.addRow(fields.map((f) => ExportService.cellValue(row[f.name])));
        }

        // Keep the header visible and filterable over long result sets.
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        if (fields.length > 0 && rows.length > 0) {
          sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: rows.length + 1, column: fields.length },
          };
        }

        await workbook.xlsx.writeFile(filePath);
      }
    );

    const note = truncated ? ` (truncated to Excel's ${EXCEL_MAX_ROWS - 1} row limit)` : '';
    vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${filePath}${note}`);
  }
}
