import * as vscode from 'vscode';
import * as fs from 'fs';
import { QueryResult } from '../model/QueryTypes.js';

export class ExportService {
  public static async exportData(tableName: string, result: QueryResult, format: 'csv' | 'json' | 'sql') {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${tableName}_export.${format}`),
      filters: {
        [format.toUpperCase()]: [format],
      },
    });

    if (!uri) {
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
}
