import * as vscode from 'vscode';

export class SqlCompletionProvider implements vscode.CompletionItemProvider {
  private static keywords = [
    'SELECT', 'FROM', 'WHERE', 'INSERT INTO', 'UPDATE', 'DELETE FROM',
    'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'GROUP BY',
    'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'CREATE TABLE', 'DROP TABLE',
    'ALTER TABLE', 'ADD COLUMN', 'PRIMARY KEY', 'FOREIGN KEY'
  ];

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const items: vscode.CompletionItem[] = [];

    // Add standard SQL keywords
    for (const kw of SqlCompletionProvider.keywords) {
      const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
      item.detail = 'SQL Keyword';
      items.push(item);
    }

    return items;
  }
}
