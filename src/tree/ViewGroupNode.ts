import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { TableNode } from './TableNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian } from '../util/i18n.js';

export class ViewGroupNode extends BaseNode {
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;
  public schemaName?: string;

  constructor(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string, schemaName?: string, parent?: BaseNode) {
    const label = isRussian() ? 'Представления (Views)' : 'Views';
    super(`views_${connectionConfig.id}_${schemaName || 'main'}`, label, 'viewGroupNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.connectionConfig = connectionConfig;
    this.password = password;
    this.sshPassword = sshPassword;
    this.schemaName = schemaName;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon('eye');
    item.contextValue = 'viewGroupNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.connectionConfig, this.password, this.sshPassword);
      const views = await driver.getViews(this.connectionConfig.database, this.schemaName);
      return views.map((v) => new TableNode(v, this.connectionConfig, this.password, this.sshPassword, this));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch views: ${err.message}`);
      return [];
    }
  }
}
