import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { ColumnInfo } from '../model/QueryTypes.js';

export class ColumnNode extends BaseNode {
  public column: ColumnInfo;

  constructor(column: ColumnInfo, parent?: BaseNode) {
    super(`col_${column.name}`, column.name, 'columnNode', vscode.TreeItemCollapsibleState.None, parent);
    this.column = column;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.None);
    item.description = `${this.column.type}${this.column.isPrimaryKey ? ' (PK)' : ''}`;
    item.iconPath = new vscode.ThemeIcon(this.column.isPrimaryKey ? 'key' : 'symbol-field');
    item.contextValue = 'columnNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    return [];
  }
}
