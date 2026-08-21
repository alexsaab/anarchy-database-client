import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { DatabaseNode } from './DatabaseNode.js';
import { TableGroupNode } from './TableGroupNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionState } from '../drivers/ConnectionState.js';
import { IconHelper } from '../util/IconHelper.js';
import { t } from '../util/i18n.js';

export class ConnectionNode extends BaseNode {
  public config: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;
  public context: vscode.ExtensionContext;

  // Live status is kept in ConnectionState, not on the node: the tree rebuilds
  // its nodes on every refresh, which would otherwise wipe the indicator.
  public get isConnected(): boolean {
    return ConnectionState.getInstance().get(this.config.id).status === 'connected';
  }

  public get hasError(): boolean {
    return ConnectionState.getInstance().isLost(this.config.id);
  }

  public get errorMessage(): string | undefined {
    return ConnectionState.getInstance().get(this.config.id).errorMessage;
  }

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
      item.description = `${this.config.type} ${t('❌ Connection lost', '❌ Соединение потеряно')} (${this.config.host || 'local'}:${this.config.port || ''})`;
      item.iconPath = new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.red'));
      item.tooltip = new vscode.MarkdownString(
        `$(debug-disconnect) **${t('Connection lost', 'Соединение потеряно')}** — ${this.config.name}\n\n` +
          `\`${this.errorMessage || t('The database closed the connection.', 'База данных закрыла соединение.')}\`\n\n` +
          `[$(sync) ${t('Reconnect', 'Переподключиться')}](command:dbClient.reconnectConnection?${encodeURIComponent(JSON.stringify([this.config.id]))})`
      );
      (item.tooltip as vscode.MarkdownString).isTrusted = true;
      (item.tooltip as vscode.MarkdownString).supportThemeIcons = true;
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

  public async reconnect(): Promise<boolean> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t(`Reconnecting to ${this.config.name}...`, `Переподключение к ${this.config.name}...`),
      },
      async () => {
        try {
          await DriverManager.getInstance().reconnect(this.config, this.password, this.sshPassword);
          vscode.window.showInformationMessage(
            t(`Reconnected to ${this.config.name}.`, `Переподключение к ${this.config.name} выполнено.`)
          );
          return true;
        } catch (err: any) {
          vscode.window.showErrorMessage(
            t(`Failed to reconnect to ${this.config.name}: ${err.message}`, `Не удалось переподключиться к ${this.config.name}: ${err.message}`)
          );
          return false;
        }
      }
    );
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.config, this.password, this.sshPassword);
      await driver.connect();

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
      ConnectionState.getInstance().markLost(this.config.id, err.message);
      vscode.window.showErrorMessage(
        t(`Failed to connect to ${this.config.name}: ${err.message}`, `Не удалось подключиться к ${this.config.name}: ${err.message}`)
      );
      return [];
    }
  }
}
