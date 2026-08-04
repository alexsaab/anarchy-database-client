import * as vscode from 'vscode';

export interface HistoryItem {
  id: string;
  sql: string;
  timestamp: number;
  costTimeMs?: number;
  connectionName: string;
}

export interface FavoriteSnippet {
  id: string;
  title: string;
  sql: string;
  createdAt: number;
}

export class QueryHistoryStorage {
  private static readonly HISTORY_KEY = 'db_client_query_history';
  private static readonly SNIPPETS_KEY = 'db_client_query_snippets';
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public getHistory(): HistoryItem[] {
    return this.context.globalState.get<HistoryItem[]>(QueryHistoryStorage.HISTORY_KEY, []);
  }

  public async addHistory(sql: string, connectionName: string, costTimeMs?: number): Promise<void> {
    const list = this.getHistory();
    const newItem: HistoryItem = {
      id: 'hist_' + Date.now(),
      sql: sql.trim(),
      timestamp: Date.now(),
      costTimeMs,
      connectionName,
    };

    // Filter duplicates and cap at 100 entries
    const filtered = [newItem, ...list.filter((item) => item.sql !== newItem.sql)].slice(0, 100);
    await this.context.globalState.update(QueryHistoryStorage.HISTORY_KEY, filtered);
  }

  public getSnippets(): FavoriteSnippet[] {
    return this.context.globalState.get<FavoriteSnippet[]>(QueryHistoryStorage.SNIPPETS_KEY, []);
  }

  public async addSnippet(title: string, sql: string): Promise<void> {
    const snippets = this.getSnippets();
    const newSnippet: FavoriteSnippet = {
      id: 'snip_' + Date.now(),
      title,
      sql: sql.trim(),
      createdAt: Date.now(),
    };
    snippets.unshift(newSnippet);
    await this.context.globalState.update(QueryHistoryStorage.SNIPPETS_KEY, snippets);
  }

  public async deleteSnippet(id: string): Promise<void> {
    const snippets = this.getSnippets().filter((s) => s.id !== id);
    await this.context.globalState.update(QueryHistoryStorage.SNIPPETS_KEY, snippets);
  }
}
