import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { ConnectionNode } from './ConnectionNode.js';

export class GroupNode extends BaseNode {
  public groupName: string;
  public connectionNodes: ConnectionNode[];

  constructor(groupName: string, connectionNodes: ConnectionNode[]) {
    super(`group_${groupName}`, groupName, 'groupNode', vscode.TreeItemCollapsibleState.Expanded);
    this.groupName = groupName;
    this.connectionNodes = connectionNodes;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = new vscode.ThemeIcon('folder');
    item.contextValue = 'groupNode';
    item.description = `(${this.connectionNodes.length})`;
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    return this.connectionNodes;
  }
}
