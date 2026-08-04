import * as vscode from 'vscode';

export abstract class BaseNode {
  public id: string;
  public label: string;
  public contextValue: string;
  public collapsibleState: vscode.TreeItemCollapsibleState;
  public parent?: BaseNode;

  constructor(id: string, label: string, contextValue: string, collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None, parent?: BaseNode) {
    this.id = id;
    this.label = label;
    this.contextValue = contextValue;
    this.collapsibleState = collapsibleState;
    this.parent = parent;
  }

  abstract getTreeItem(): vscode.TreeItem | Promise<vscode.TreeItem>;
  abstract getChildren(): Promise<BaseNode[]>;
}
