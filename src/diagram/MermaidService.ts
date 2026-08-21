import * as vscode from 'vscode';
import * as fs from 'fs';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { ColumnInfo, TableInfo } from '../model/QueryTypes.js';
import { ForeignKeyInfo } from '../drivers/BaseDriver.js';
import { t } from '../util/i18n.js';

interface TableSchema {
  table: TableInfo;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

interface Relation {
  parent: string;
  child: string;
  label: string;
}

/** Builds Mermaid `erDiagram` source from a live database schema. */
export class MermaidService {
  /**
   * Mermaid attribute names take letters, digits, underscore and dash. Unicode
   * letters parse fine, so names like `данные` are kept rather than mangled.
   */
  private static ident(raw: string, fallback: string): string {
    const cleaned = String(raw ?? '')
      .trim()
      .replace(/[^\p{L}\p{N}_-]/gu, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return cleaned || fallback;
  }

  /** Types like `character varying(255)` or `NUMERIC(10, 2)` must collapse to one token. */
  private static typeToken(raw: string): string {
    return MermaidService.ident(String(raw ?? 'unknown').toLowerCase(), 'unknown');
  }

  private static entityName(table: TableInfo, includeSchema: boolean): string {
    const base = includeSchema && table.schema ? `${table.schema}.${table.name}` : table.name;
    // Entity names are quoted, so only the quote character itself is a problem.
    return base.replace(/"/g, "'");
  }

  public static build(databaseName: string, schemas: TableSchema[]): string {
    const includeSchema = new Set(schemas.map((s) => s.table.schema).filter(Boolean)).size > 1;

    const known = new Map<string, string>();
    for (const s of schemas) {
      known.set(s.table.name, MermaidService.entityName(s.table, includeSchema));
    }

    const lines: string[] = ['erDiagram'];

    for (const { table, columns, foreignKeys } of schemas) {
      const fkColumns = new Set(foreignKeys.map((f) => f.columnName));
      lines.push(`    "${MermaidService.entityName(table, includeSchema)}" {`);

      if (columns.length === 0) {
        lines.push('        unknown no_columns_readable');
      }

      const usedNames = new Set<string>();
      for (let index = 0; index < columns.length; index++) {
        const col = columns[index];
        let name = MermaidService.ident(col.name, `col_${index + 1}`);
        // Sanitising can collide (e.g. "a b" and "a-b" both become "a_b").
        let suffix = 2;
        while (usedNames.has(name)) {
          name = `${name}_${suffix++}`;
        }
        usedNames.add(name);

        // Mermaid accepts several constraints on one attribute, comma separated,
        // so a primary key that is also a foreign key shows both.
        const keys: string[] = [];
        if (col.isPrimaryKey) {
          keys.push('PK');
        }
        if (fkColumns.has(col.name)) {
          keys.push('FK');
        }
        const key = keys.length > 0 ? ` ${keys.join(', ')}` : '';
        const notes: string[] = [];
        if (col.name !== name) {
          notes.push(col.name);
        }
        if (col.nullable === false) {
          notes.push('NOT NULL');
        }
        const comment = notes.length > 0 ? ` "${notes.join(' · ').replace(/"/g, "'")}"` : '';
        lines.push(`        ${MermaidService.typeToken(col.type)} ${name}${key}${comment}`);
      }

      lines.push('    }');
    }

    // Composite foreign keys arrive as one row per column; collapse them so the
    // diagram shows one edge per constraint.
    const relations = new Map<string, Relation>();
    for (const { table, foreignKeys } of schemas) {
      const byConstraint = new Map<string, ForeignKeyInfo[]>();
      for (const fk of foreignKeys) {
        if (!fk.referencedTable) {
          continue;
        }
        const key = fk.constraintName || `${fk.columnName}->${fk.referencedTable}`;
        const list = byConstraint.get(key) || [];
        list.push(fk);
        byConstraint.set(key, list);
      }

      for (const [, group] of byConstraint) {
        const parentTable = group[0].referencedTable;
        const parent = known.get(parentTable) || parentTable;
        const child = MermaidService.entityName(table, includeSchema);
        const label = group.map((g) => g.columnName).join(', ').replace(/"/g, "'");
        relations.set(`${parent}|${child}|${label}`, { parent, child, label });
      }
    }

    for (const r of relations.values()) {
      lines.push(`    "${r.parent}" ||--o{ "${r.child}" : "${r.label}"`);
    }

    return lines.join('\n');
  }

  /** Reads the schema, renders Mermaid, and hands the user the result. */
  public static async generate(
    connectionConfig: ConnectionConfig,
    password?: string,
    sshPassword?: string,
    schemaName?: string
  ): Promise<void> {
    const databaseName = connectionConfig.database || connectionConfig.name;

    try {
      const driver = await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword);
      const tables = await driver.getTables(connectionConfig.database, schemaName);

      if (tables.length === 0) {
        vscode.window.showWarningMessage(t(`No tables found in ${databaseName}.`, `В ${databaseName} нет таблиц.`));
        return;
      }

      const LARGE = 60;
      let selected = tables;
      if (tables.length > LARGE) {
        const all = t(`Include all ${tables.length}`, `Все ${tables.length}`);
        const pick = t(`Choose tables...`, `Выбрать таблицы...`);
        const answer = await vscode.window.showWarningMessage(
          t(
            `${databaseName} has ${tables.length} tables. A diagram that large is slow to render.`,
            `В ${databaseName} ${tables.length} таблиц. Такая большая диаграмма будет медленно отображаться.`
          ),
          all,
          pick
        );
        if (!answer) {
          return;
        }
        if (answer === pick) {
          const chosen = await vscode.window.showQuickPick(
            tables.map((tbl) => ({ label: tbl.name, description: tbl.schema, picked: true, table: tbl })),
            { canPickMany: true, title: t('Tables to include', 'Таблицы для диаграммы') }
          );
          if (!chosen || chosen.length === 0) {
            return;
          }
          selected = chosen.map((c) => c.table);
        }
      }

      const schemas = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t(`Reading schema of ${databaseName}...`, `Чтение схемы ${databaseName}...`),
          cancellable: true,
        },
        async (progress, token) => {
          const out: TableSchema[] = [];
          let done = 0;
          for (const table of selected) {
            if (token.isCancellationRequested) {
              break;
            }
            progress.report({
              message: `${++done}/${selected.length}  ${table.name}`,
              increment: 100 / selected.length,
            });
            try {
              const columns = await driver.getColumns(table.name, connectionConfig.database, table.schema);
              let foreignKeys: ForeignKeyInfo[] = [];
              try {
                foreignKeys = await driver.getForeignKeys(table.name, connectionConfig.database, table.schema);
              } catch (e) {
                // Views and engines without FK support simply have none.
              }
              out.push({ table, columns, foreignKeys });
            } catch (e) {
              out.push({ table, columns: [], foreignKeys: [] });
            }
          }
          return out;
        }
      );

      if (schemas.length === 0) {
        return;
      }

      const mermaid = MermaidService.build(databaseName, schemas);
      const relationCount = mermaid.split('\n').filter((l) => l.includes('||--o{')).length;
      await MermaidService.deliver(databaseName, mermaid, schemas.length, relationCount);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to generate Mermaid diagram: ${err.message}`);
    }
  }

  private static async deliver(
    databaseName: string,
    mermaid: string,
    tableCount: number,
    relationCount: number
  ): Promise<void> {
    const markdown =
      `# ER Diagram: ${databaseName}\n\n` +
      `<!-- ${tableCount} tables, ${relationCount} relationships -->\n\n` +
      '```mermaid\n' +
      mermaid +
      '\n```\n';

    const openDoc = t('Open in editor', 'Открыть в редакторе');
    const copy = t('Copy to clipboard', 'Скопировать');
    const save = t('Save as file...', 'Сохранить в файл...');

    const choice = await vscode.window.showInformationMessage(
      t(
        `Mermaid diagram ready: ${tableCount} tables, ${relationCount} relationships.`,
        `Диаграмма Mermaid готова: таблиц ${tableCount}, связей ${relationCount}.`
      ),
      openDoc,
      copy,
      save
    );

    if (choice === copy) {
      await vscode.env.clipboard.writeText(mermaid);
      vscode.window.showInformationMessage(t('Mermaid source copied.', 'Код Mermaid скопирован.'));
      return;
    }

    if (choice === save) {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${databaseName}_erd.md`),
        filters: { Markdown: ['md'], Mermaid: ['mmd'] },
      });
      if (uri) {
        const body = uri.fsPath.endsWith('.mmd') ? mermaid : markdown;
        fs.writeFileSync(uri.fsPath, body, 'utf8');
        vscode.window.showInformationMessage(`Saved to ${uri.fsPath}`);
      }
      return;
    }

    if (choice === openDoc) {
      // Markdown, so VS Code's built-in preview renders the diagram natively.
      const doc = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
      await vscode.window.showTextDocument(doc, { preview: false });
      await vscode.commands.executeCommand('markdown.showPreviewToSide').then(undefined, () => {});
    }
  }
}
