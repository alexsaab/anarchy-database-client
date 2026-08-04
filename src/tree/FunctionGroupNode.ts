import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { ScriptNode } from './ScriptNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian } from '../util/i18n.js';

export class FunctionGroupNode extends BaseNode {
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;
  public schemaName?: string;

  constructor(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string, schemaName?: string, parent?: BaseNode) {
    const label = isRussian() ? 'Функции (Functions)' : 'Functions';
    super(`funcs_${connectionConfig.id}_${schemaName || 'main'}`, label, 'functionGroupNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.connectionConfig = connectionConfig;
    this.password = password;
    this.sshPassword = sshPassword;
    this.schemaName = schemaName;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon('symbol-method');
    item.contextValue = 'functionGroupNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.connectionConfig, this.password, this.sshPassword);
      const funcs = await driver.getFunctions(this.connectionConfig.database, this.schemaName);
      return funcs.map((f) => new ScriptNode(f.name, 'function', this.connectionConfig, this.password, this.sshPassword, this.schemaName, this));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch functions: ${err.message}`);
      return [];
    }
  }
}
