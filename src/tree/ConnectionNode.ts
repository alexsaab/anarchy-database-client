import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { DatabaseNode } from './DatabaseNode.js';
import { TableGroupNode } from './TableGroupNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { IconHelper } from '../util/IconHelper.js';

export class ConnectionNode extends BaseNode {
  public config: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;
  public context: vscode.ExtensionContext;
  private isConnected: boolean = false;

  constructor(config: ConnectionConfig, context: vscode.ExtensionContext, password?: string, sshPassword?: string) {
    super(`conn_${config.id}`, config.name, 'connectionNode', vscode.TreeItemCollapsibleState.Collapsed);
    this.config = config;
    this.context = context;
    this.password = password;
    this.sshPassword = sshPassword;
  }

  getTreeItem(): vscode.TreeItem {
    const badge = IconHelper.getColorBadge(this.config.color);
    const labelText = badge ? `${badge} ${this.config.name}` : this.config.name;

    const item = new vscode.TreeItem(labelText, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = `${this.config.type} (${this.config.host || 'local'}:${this.config.port || ''})`;

    const themeColor = IconHelper.getThemeColor(this.config.color);
    if (themeColor) {
      item.iconPath = new vscode.ThemeIcon(this.isConnected ? 'database' : 'server', themeColor);
    } else {
      item.iconPath = IconHelper.getConnectionIcon(this.config.type, this.isConnected);
    }
    item.contextValue = 'connectionNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.config, this.password, this.sshPassword);
      await driver.connect();
      this.isConnected = true;

      if (this.config.type === 'SQLite') {
        return [new TableGroupNode(this.config, this.password, this.sshPassword, 'main', this)];
      }

      if (this.config.database) {
        return [new DatabaseNode(this.config.database, this.config, this.context, this.password, this.sshPassword, this)];
      }

      const dbs = await driver.getDatabases();
      return dbs.map((dbName) => new DatabaseNode(dbName, this.config, this.context, this.password, this.sshPassword, this));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to connect to ${this.config.name}: ${err.message}`);
      return [];
    }
  }
}
