import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';

export class ScriptNode extends BaseNode {
  public objectName: string;
  public objectType: 'view' | 'function' | 'procedure' | 'trigger';
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;
  public schemaName?: string;

  constructor(
    objectName: string,
    objectType: 'view' | 'function' | 'procedure' | 'trigger',
    connectionConfig: ConnectionConfig,
    password?: string,
    sshPassword?: string,
    schemaName?: string,
    parent?: BaseNode
  ) {
    super(`script_${objectType}_${objectName}`, objectName, 'scriptNode', vscode.TreeItemCollapsibleState.None, parent);
    this.objectName = objectName;
    this.objectType = objectType;
    this.connectionConfig = connectionConfig;
    this.password = password;
    this.sshPassword = sshPassword;
    this.schemaName = schemaName;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.None);
    if (this.objectType === 'function') item.iconPath = new vscode.ThemeIcon('symbol-method');
    else if (this.objectType === 'procedure') item.iconPath = new vscode.ThemeIcon('gear');
    else if (this.objectType === 'trigger') item.iconPath = new vscode.ThemeIcon('zap');
    else item.iconPath = new vscode.ThemeIcon('eye');

    item.contextValue = 'scriptNode';
    item.command = {
      command: 'dbClient.openScript',
      title: 'Open DDL Script',
      arguments: [this],
    };
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    return [];
  }
}
