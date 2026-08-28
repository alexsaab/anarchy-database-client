import * as vscode from 'vscode';
import { SchemaMetadataCache } from './SchemaMetadataCache.js';

export class SqlHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const range = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+/);
    if (!range) return null;

    const word = document.getText(range).toLowerCase();
    const metadata = SchemaMetadataCache.getInstance().getMetadata();
    if (!metadata) return null;

    // Check if hovered word is a table name
    if (metadata.tables.has(word)) {
      const tableMeta = metadata.tables.get(word)!;
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`### 🗄️ Table \`${tableMeta.table.name}\`\n\n`);
      md.appendMarkdown(`*Database:* \`${metadata.database || 'default'}\` | *Connection:* \`${metadata.connectionName}\`\n\n`);
      md.appendMarkdown(`| Column | Type | Nullable | Key |\n| :--- | :--- | :--- | :--- |\n`);

      for (const col of tableMeta.columns) {
        const pk = col.isPrimaryKey ? '🔑 PK' : '';
        const nullable = col.nullable ? 'YES' : 'NO';
        md.appendMarkdown(`| \`${col.name}\` | \`${col.type}\` | ${nullable} | ${pk} |\n`);
      }

      if (tableMeta.foreignKeys.length > 0) {
        md.appendMarkdown(`\n**Foreign Keys:**\n`);
        for (const fk of tableMeta.foreignKeys) {
          md.appendMarkdown(`- \`${fk.columnName}\` ➔ \`${fk.referencedTable}.${fk.referencedColumn}\`\n`);
        }
      }

      return new vscode.Hover(md, range);
    }

    // Check if hovered word is a column name across tables
    const matchedColumns: { tableName: string; type: string; nullable?: boolean; pk?: boolean }[] = [];
    for (const [tblName, tblMeta] of metadata.tables.entries()) {
      const col = tblMeta.columns.find((c) => c.name.toLowerCase() === word);
      if (col) {
        matchedColumns.push({
          tableName: tblMeta.table.name,
          type: col.type,
          nullable: col.nullable,
          pk: col.isPrimaryKey,
        });
      }
    }

    if (matchedColumns.length > 0) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`### 🏷️ Column \`${word}\`\n\n`);
      for (const match of matchedColumns) {
        md.appendMarkdown(`* In **\`${match.tableName}\`**: \`${match.type}\` (${match.nullable ? 'nullable' : 'not null'}${match.pk ? ', 🔑 Primary Key' : ''})\n`);
      }
      return new vscode.Hover(md, range);
    }

    return null;
  }
}
