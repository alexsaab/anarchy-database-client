import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';

export class QueryFileNode extends BaseNode {
  public filePath: string;
  public fileName: string;

  constructor(fileName: string, filePath: string, parent?: BaseNode) {
    super(`queryFile_${filePath}`, fileName, 'queryFileNode', vscode.TreeItemCollapsibleState.None, parent);
    this.fileName = fileName;
    this.filePath = filePath;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.contextValue = 'queryFileNode';
    item.command = {
      command: 'vscode.open',
      title: 'Open Query File',
      arguments: [vscode.Uri.file(this.filePath)],
    };
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    return [];
  }
}
