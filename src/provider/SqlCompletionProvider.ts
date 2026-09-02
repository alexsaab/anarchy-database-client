import * as vscode from 'vscode';
import { SchemaMetadataCache, CachedConnectionMetadata } from './SchemaMetadataCache.js';

export class SqlCompletionProvider implements vscode.CompletionItemProvider {
  private static KEYWORDS = [
    'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN',
    'FULL OUTER JOIN', 'CROSS JOIN', 'ON', 'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
    'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS', 'WITH', 'CREATE TABLE',
    'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE', 'CREATE INDEX', 'DROP INDEX', 'PRIMARY KEY', 'FOREIGN KEY',
    'REFERENCES', 'CHECK', 'DEFAULT', 'AUTO_INCREMENT', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION'
  ];

  private static FUNCTIONS = [
    { name: 'COUNT', snippet: 'COUNT(${1:*})', desc: 'Counts rows matching criteria' },
    { name: 'SUM', snippet: 'SUM(${1:column})', desc: 'Calculates the sum of values' },
    { name: 'AVG', snippet: 'AVG(${1:column})', desc: 'Calculates average value' },
    { name: 'MIN', snippet: 'MIN(${1:column})', desc: 'Returns minimum value' },
    { name: 'MAX', snippet: 'MAX(${1:column})', desc: 'Returns maximum value' },
    { name: 'COALESCE', snippet: 'COALESCE(${1:val1}, ${2:val2})', desc: 'Returns first non-null argument' },
    { name: 'CONCAT', snippet: 'CONCAT(${1:str1}, ${2:str2})', desc: 'Concatenates multiple strings' },
    { name: 'NOW', snippet: 'NOW()', desc: 'Current date and time timestamp' },
    { name: 'DATE_TRUNC', snippet: "DATE_TRUNC('${1:day}', ${2:timestamp_col})", desc: 'Truncates date to specified precision' },
    { name: 'LOWER', snippet: 'LOWER(${1:column})', desc: 'Converts string to lowercase' },
    { name: 'UPPER', snippet: 'UPPER(${1:column})', desc: 'Converts string to uppercase' },
    { name: 'SUBSTRING', snippet: 'SUBSTRING(${1:str} FROM ${2:1} FOR ${3:10})', desc: 'Extracts substring' },
    { name: 'ROUND', snippet: 'ROUND(${1:val}, ${2:2})', desc: 'Rounds number to decimal places' },
    { name: 'ROW_NUMBER', snippet: 'ROW_NUMBER() OVER (${1:ORDER BY id})', desc: 'Assigns unique row number' },
  ];

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const items: vscode.CompletionItem[] = [];
    const lineText = document.lineAt(position).text;
    const linePrefix = lineText.substring(0, position.character);

    const metadata = SchemaMetadataCache.getInstance().getMetadata();

    // Check if user is typing after a dot (e.g. `users.` or `u.`)
    const dotMatch = linePrefix.match(/([a-zA-Z0-9_]+)\.$/);
    if (dotMatch && metadata) {
      const tableOrAlias = dotMatch[1].toLowerCase();
      const resolvedTableName = this.resolveAlias(document.getText(), tableOrAlias, metadata);
      const tableMeta = metadata.tables.get(resolvedTableName);

      if (tableMeta) {
        for (const col of tableMeta.columns) {
          const item = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
          item.detail = `${col.type}${col.isPrimaryKey ? ' (PK)' : ''}${col.nullable ? ' NULL' : ' NOT NULL'}`;
          item.documentation = new vscode.MarkdownString(
            `**Column**: \`${col.name}\`\n\n**Type**: \`${col.type}\`\n\n**Table**: \`${tableMeta.table.name}\``
          );
          items.push(item);
        }
        return items;
      }
    }

    // Check if user is typing after `JOIN` (e.g. `SELECT * FROM users JOIN `)
    const joinMatch = linePrefix.match(/(?:inner\s+|left\s+|right\s+|full\s+)?join\s*$/i);
    if (joinMatch && metadata) {
      const docText = document.getText();
      const fromMatches = Array.from(docText.matchAll(/(?:from|join)\s+([a-zA-Z0-9_]+)(?:\s+(?:as\s+)?([a-zA-Z0-9_]+))?/gi));
      const activeTables = new Map<string, string>();
      for (const m of fromMatches) {
        const tbl = m[1].toLowerCase();
        const alias = m[2] && !['where', 'join', 'inner', 'left', 'right', 'full', 'on', 'group', 'order', 'limit'].includes(m[2].toLowerCase())
          ? m[2]
          : m[1];
        if (metadata.tables.has(tbl)) {
          activeTables.set(tbl, alias);
        }
      }

      for (const [activeTbl, activeAlias] of activeTables.entries()) {
        const activeMeta = metadata.tables.get(activeTbl);
        if (activeMeta) {
          for (const fk of activeMeta.foreignKeys) {
            const targetTbl = (fk.referencedTable || '').toLowerCase();
            const targetCol = fk.referencedColumn || 'id';
            const srcCol = fk.columnName;
            const targetMeta = metadata.tables.get(targetTbl);
            const targetDisplay = targetMeta ? targetMeta.table.name : fk.referencedTable;
            const label = `${targetDisplay} ON ${targetDisplay}.${targetCol} = ${activeAlias}.${srcCol}`;
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
            item.detail = `Smart JOIN: ${activeMeta.table.name} -> ${targetDisplay}`;
            item.insertText = label;
            items.push(item);
          }
        }

        for (const [tblKey, otherMeta] of metadata.tables.entries()) {
          for (const fk of otherMeta.foreignKeys) {
            if ((fk.referencedTable || '').toLowerCase() === activeTbl) {
              const targetCol = fk.referencedColumn || 'id';
              const srcCol = fk.columnName;
              const label = `${otherMeta.table.name} ON ${otherMeta.table.name}.${srcCol} = ${activeAlias}.${targetCol}`;
              const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
              item.detail = `Smart JOIN: ${otherMeta.table.name} -> ${activeMeta ? activeMeta.table.name : activeTbl}`;
              item.insertText = label;
              items.push(item);
            }
          }
        }
      }
    }

    // Check if user is typing after `ON` in a `JOIN` clause
    const joinOnMatch = linePrefix.match(/join\s+([a-zA-Z0-9_]+)(?:\s+(?:as\s+)?([a-zA-Z0-9_]+))?\s+on\s*$/i);
    if (joinOnMatch && metadata) {
      const joinedTable = joinOnMatch[1].toLowerCase();
      const joinedAlias = joinOnMatch[2] || joinOnMatch[1];
      const joinedMeta = metadata.tables.get(joinedTable);

      if (joinedMeta && joinedMeta.foreignKeys.length > 0) {
        for (const fk of joinedMeta.foreignKeys) {
          const targetTable = (fk.referencedTable || '').toLowerCase();
          const targetCol = fk.referencedColumn || 'id';
          const srcCol = fk.columnName;

          const label = `${joinedAlias}.${srcCol} = ${targetTable}.${targetCol}`;
          const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
          item.detail = `Foreign Key Join: ${joinedMeta.table.name} -> ${fk.referencedTable}`;
          item.insertText = label;
          items.push(item);
        }
      }

      // Check reverse FKs (other tables referencing joinedTable)
      for (const [tblKey, otherMeta] of metadata.tables.entries()) {
        for (const fk of otherMeta.foreignKeys) {
          if ((fk.referencedTable || '').toLowerCase() === joinedTable) {
            const label = `${otherMeta.table.name}.${fk.columnName} = ${joinedAlias}.${fk.referencedColumn || 'id'}`;
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
            item.detail = `Foreign Key Join: ${otherMeta.table.name} -> ${joinedMeta ? joinedMeta.table.name : joinedTable}`;
            item.insertText = label;
            items.push(item);
          }
        }
      }
    }

    // Add schema tables
    if (metadata) {
      for (const [tblKey, tblMeta] of metadata.tables.entries()) {
        const item = new vscode.CompletionItem(tblMeta.table.name, vscode.CompletionItemKind.Class);
        item.detail = `${tblMeta.table.type === 'view' ? 'View' : 'Table'} (${metadata.connectionName})`;
        item.documentation = new vscode.MarkdownString(
          `**${tblMeta.table.name}**\n\nColumns: ${tblMeta.columns.map((c) => `\`${c.name}\` (${c.type})`).join(', ')}`
        );
        items.push(item);

        // Also add columns as standalone completions
        for (const col of tblMeta.columns) {
          const colItem = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
          colItem.detail = `${col.type} · ${tblMeta.table.name}`;
          items.push(colItem);
        }
      }
    }

    // Add SQL Functions with Snippets
    for (const fn of SqlCompletionProvider.FUNCTIONS) {
      const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
      item.detail = fn.desc;
      item.insertText = new vscode.SnippetString(fn.snippet);
      items.push(item);
    }

    // Add SQL Keywords
    for (const kw of SqlCompletionProvider.KEYWORDS) {
      const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
      item.detail = 'SQL Keyword';
      items.push(item);
    }

    return items;
  }

  private resolveAlias(fullSql: string, aliasOrTable: string, metadata: CachedConnectionMetadata): string {
    // If it is already a direct table name
    if (metadata.tables.has(aliasOrTable)) {
      return aliasOrTable;
    }

    // Look for patterns like `FROM users u` or `JOIN users AS u`
    const regex = new RegExp(`(?:FROM|JOIN)\\s+([a-zA-Z0-9_]+)\\s+(?:AS\\s+)?${aliasOrTable}\\b`, 'i');
    const match = fullSql.match(regex);
    if (match && match[1]) {
      const matchedTable = match[1].toLowerCase();
      if (metadata.tables.has(matchedTable)) {
        return matchedTable;
      }
    }

    return aliasOrTable;
  }
}
