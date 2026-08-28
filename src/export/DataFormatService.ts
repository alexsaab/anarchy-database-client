import { ColumnInfo } from '../model/QueryTypes.js';

export class DataFormatService {
  /**
   * Formats rows as a GitHub Flavored Markdown table.
   */
  public static toMarkdown(rows: any[], fields?: ColumnInfo[]): string {
    if (!rows || rows.length === 0) return '';
    const colNames = fields && fields.length > 0 ? fields.map((f) => f.name) : Object.keys(rows[0]);
    if (colNames.length === 0) return '';

    const header = `| ${colNames.join(' | ')} |`;
    const separator = `| ${colNames.map(() => '---').join(' | ')} |`;
    const body = rows
      .map((row) => `| ${colNames.map((col) => DataFormatService.formatCell(row[col])).join(' | ')} |`)
      .join('\n');

    return `${header}\n${separator}\n${body}`;
  }

  /**
   * Formats rows as SQL INSERT statements.
   */
  public static toSqlInsert(tableName: string, rows: any[], fields?: ColumnInfo[]): string {
    if (!rows || rows.length === 0) return '';
    const colNames = fields && fields.length > 0 ? fields.map((f) => f.name) : Object.keys(rows[0]);
    if (colNames.length === 0) return '';

    const colsStr = colNames.map((c) => `\`${c}\``).join(', ');
    const valueStatements = rows.map((row) => {
      const values = colNames.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number' || typeof val === 'bigint') return String(val);
        if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      return `INSERT INTO \`${tableName}\` (${colsStr}) VALUES (${values.join(', ')});`;
    });

    return valueStatements.join('\n');
  }

  /**
   * Formats rows as a pretty JSON string.
   */
  public static toJson(rows: any[]): string {
    return JSON.stringify(rows || [], null, 2);
  }

  /**
   * Generates a TypeScript interface declaration matching the table columns and data types.
   */
  public static toTypeScript(interfaceName: string, fields: ColumnInfo[]): string {
    const pascalName = interfaceName
      .replace(/[^a-zA-Z0-9_]/g, '')
      .replace(/(^|_)([a-z])/g, (_, __, letter) => letter.toUpperCase());

    const lines = fields.map((f) => {
      let tsType = 'string';
      const t = f.type.toLowerCase();
      if (t.includes('int') || t.includes('float') || t.includes('double') || t.includes('numeric') || t.includes('decimal') || t.includes('real')) {
        tsType = 'number';
      } else if (t.includes('bool')) {
        tsType = 'boolean';
      } else if (t.includes('json')) {
        tsType = 'Record<string, any>';
      } else if (t.includes('date') || t.includes('time')) {
        tsType = 'Date | string';
      }
      const optional = f.nullable ? '?' : '';
      return `  ${f.name}${optional}: ${tsType};`;
    });

    return `export interface ${pascalName || 'RecordItem'} {\n${lines.join('\n')}\n}`;
  }

  private static formatCell(val: any): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'object') {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }
}
