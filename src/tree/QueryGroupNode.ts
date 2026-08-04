import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { QueryFileNode } from './QueryFileNode.js';
import { QueryFileStorage } from '../storage/QueryFileStorage.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { isRussian } from '../util/i18n.js';

class EmptyQueryPlaceholderNode extends BaseNode {
  constructor(parent?: BaseNode) {
    const label = isRussian() ? 'Нет сохраненных SQL файлов.' : 'No query files found.';
    super('empty_query_placeholder', label, 'emptyQueryNode', vscode.TreeItemCollapsibleState.None, parent);
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('info');
    item.contextValue = 'emptyQueryNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    return [];
  }
}

export class QueryGroupNode extends BaseNode {
  public connectionConfig: ConnectionConfig;
  public dbName?: string;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, connectionConfig: ConnectionConfig, dbName?: string, parent?: BaseNode) {
    const label = 'Query';
    super(`queryGroup_${connectionConfig.id}_${dbName || 'default'}`, label, 'queryGroupNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.context = context;
    this.connectionConfig = connectionConfig;
    this.dbName = dbName;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon('database');
    item.contextValue = 'queryGroupNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    const files = QueryFileStorage.getQueryFiles(this.context, this.connectionConfig.id, this.dbName);
    if (files.length === 0) {
      return [new EmptyQueryPlaceholderNode(this)];
    }
    return files.map((f) => new QueryFileNode(f.name, f.filePath, this));
  }
}
