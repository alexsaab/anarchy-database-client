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
  public isConnected: boolean = false;
  public hasError: boolean = false;
  public errorMessage?: string;

  constructor(config: ConnectionConfig, context: vscode.ExtensionContext, password?: string, sshPassword?: string) {
    super(`conn_${config.id}`, config.name, 'connectionNode', vscode.TreeItemCollapsibleState.Collapsed);
    this.config = config;
    this.context = context;
    this.password = password;
    this.sshPassword = sshPassword;
  }

  getTreeItem(): vscode.TreeItem {
    let badge = IconHelper.getColorBadge(this.config.color);
    if (this.hasError) {
      badge = '🔴';
    } else if (this.isConnected) {
      badge = badge || '🟢';
    }

    const labelText = badge ? `${badge} ${this.config.name}` : this.config.name;
    const item = new vscode.TreeItem(labelText, vscode.TreeItemCollapsibleState.Collapsed);

    if (this.hasError) {
      item.description = `${this.config.type} ❌ Disconnected (${this.config.host || 'local'}:${this.config.port || ''})`;
      item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      item.tooltip = `❌ Connection Error: ${this.errorMessage}\nClick or use Reconnect to retry.`;
    } else if (this.isConnected) {
      item.description = `${this.config.type} 🟢 Connected (${this.config.host || 'local'}:${this.config.port || ''})`;
      const themeColor = IconHelper.getThemeColor(this.config.color) || new vscode.ThemeColor('charts.green');
      item.iconPath = new vscode.ThemeIcon('database', themeColor);
      item.tooltip = `🟢 Connected: ${this.config.name} (${this.config.type})`;
    } else {
      item.description = `${this.config.type} (${this.config.host || 'local'}:${this.config.port || ''})`;
      const themeColor = IconHelper.getThemeColor(this.config.color);
      if (themeColor) {
        item.iconPath = new vscode.ThemeIcon('server', themeColor);
      } else {
        item.iconPath = IconHelper.getConnectionIcon(this.config.type, false);
      }
      item.tooltip = `${this.config.name} (${this.config.type})`;
    }

    item.contextValue = 'connectionNode';
    return item;
  }

  public async reconnect(): Promise<void> {
    await DriverManager.getInstance().removeDriver(this.config.id);
    this.isConnected = false;
    this.hasError = false;
    this.errorMessage = undefined;

    try {
      const driver = await DriverManager.getInstance().getDriver(this.config, this.password, this.sshPassword);
      await driver.connect();
      this.isConnected = true;
      this.hasError = false;
      vscode.window.showInformationMessage(`Successfully reconnected to ${this.config.name}!`);
    } catch (err: any) {
      this.isConnected = false;
      this.hasError = true;
      this.errorMessage = err.message;
      vscode.window.showErrorMessage(`Failed to reconnect to ${this.config.name}: ${err.message}`);
    }
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.config, this.password, this.sshPassword);
      await driver.connect();
      this.isConnected = true;
      this.hasError = false;
      this.errorMessage = undefined;

      if (this.config.type === 'SQLite') {
        return [new TableGroupNode(this.config, this.password, this.sshPassword, 'main', this)];
      }

      if (this.config.database) {
        return [new DatabaseNode(this.config.database, this.config, this.context, this.password, this.sshPassword, this)];
      }

      const dbs = await driver.getDatabases();
      dbs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return dbs.map((dbName) => new DatabaseNode(dbName, this.config, this.context, this.password, this.sshPassword, this));
    } catch (err: any) {
      this.isConnected = false;
      this.hasError = true;
      this.errorMessage = err.message;
      vscode.window.showErrorMessage(`Failed to connect to ${this.config.name}: ${err.message}`);
      return [];
    }
  }
}
