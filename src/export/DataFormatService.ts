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
   * Formats rows as Tab-Separated Values (TSV).
   */
  public static toTsv(rows: any[], fields?: ColumnInfo[]): string {
    if (!rows || rows.length === 0) return '';
    const colNames = fields && fields.length > 0 ? fields.map((f) => f.name) : Object.keys(rows[0]);
    if (colNames.length === 0) return '';

    const lines = [colNames.join('\t')];
    rows.forEach((r) => {
      lines.push(
        colNames
          .map((c) => {
            const v = r[c];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'object') return JSON.stringify(v);
            return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
          })
          .join('\t')
      );
    });
    return lines.join('\n');
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

  /**
   * Generates a Go struct declaration matching the table columns and data types.
   * Nullable columns become pointers, which is how encoding/json and database/sql
   * both represent "may be absent".
   */
  public static toGoStruct(structName: string, fields: ColumnInfo[]): string {
    const pascalName = DataFormatService.toPascalCase(structName) || 'RecordItem';

    const lines = fields.map((f) => {
      let goType = 'string';
      const t = f.type.toLowerCase();
      if (t.includes('bigint') || t.includes('int8')) {
        goType = 'int64';
      } else if (t.includes('int') || t.includes('serial')) {
        goType = 'int';
      } else if (t.includes('float') || t.includes('double') || t.includes('numeric') || t.includes('decimal') || t.includes('real')) {
        goType = 'float64';
      } else if (t.includes('bool')) {
        goType = 'bool';
      } else if (t.includes('json')) {
        goType = 'map[string]interface{}';
      } else if (t.includes('date') || t.includes('time')) {
        goType = 'time.Time';
      } else if (t.includes('blob') || t.includes('bytea') || t.includes('binary')) {
        goType = '[]byte';
      }
      // Slices and maps are already nilable; pointing at them would only add noise.
      const nilable = goType.startsWith('[]') || goType.startsWith('map[');
      const finalType = f.nullable && !nilable ? `*${goType}` : goType;
      const omit = f.nullable ? ',omitempty' : '';
      return `\t${DataFormatService.toPascalCase(f.name)} ${finalType} \`json:"${f.name}${omit}" db:"${f.name}"\``;
    });

    return `type ${pascalName} struct {\n${lines.join('\n')}\n}`;
  }

  /**
   * Generates a Python dataclass declaration matching the table columns and data types.
   */
  public static toPythonDataclass(className: string, fields: ColumnInfo[]): string {
    const pascalName = DataFormatService.toPascalCase(className) || 'RecordItem';

    const usesDatetime = fields.some((f) => /date|time/i.test(f.type));
    const usesAny = fields.some((f) => /json/i.test(f.type));
    const hasOptional = fields.some((f) => f.nullable);

    const typing: string[] = [];
    if (usesAny) typing.push('Any');
    if (hasOptional) typing.push('Optional');

    const imports = ['from dataclasses import dataclass'];
    if (usesDatetime) imports.push('from datetime import datetime');
    if (typing.length > 0) imports.push(`from typing import ${typing.join(', ')}`);

    const lines = fields.map((f) => {
      let pyType = 'str';
      const t = f.type.toLowerCase();
      if (t.includes('int') || t.includes('serial')) {
        pyType = 'int';
      } else if (t.includes('float') || t.includes('double') || t.includes('numeric') || t.includes('decimal') || t.includes('real')) {
        pyType = 'float';
      } else if (t.includes('bool')) {
        pyType = 'bool';
      } else if (t.includes('json')) {
        pyType = 'dict[str, Any]';
      } else if (t.includes('date') || t.includes('time')) {
        pyType = 'datetime';
      } else if (t.includes('blob') || t.includes('bytea') || t.includes('binary')) {
        pyType = 'bytes';
      }
      // Defaulted fields must follow required ones, so nullable columns get `= None`.
      return f.nullable ? `    ${f.name}: Optional[${pyType}] = None` : `    ${f.name}: ${pyType}`;
    });

    // Python rejects a non-default field after a defaulted one; keep required columns first.
    const required = lines.filter((l) => !l.includes('= None'));
    const optional = lines.filter((l) => l.includes('= None'));
    const body = [...required, ...optional].join('\n') || '    pass';

    return `${imports.join('\n')}\n\n\n@dataclass\nclass ${pascalName}:\n${body}`;
  }

  /** `user_account` / `user-account` -> `UserAccount`. */
  private static toPascalCase(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .split(/[_\- ]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
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
