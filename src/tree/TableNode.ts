import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { ColumnNode } from './ColumnNode.js';
import { TableInfo } from '../model/QueryTypes.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';

export class TableNode extends BaseNode {
  public table: TableInfo;
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;

  constructor(table: TableInfo, connectionConfig: ConnectionConfig, password?: string, sshPassword?: string, parent?: BaseNode) {
    super(`table_${table.name}`, table.name, 'tableNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.table = table;
    this.connectionConfig = connectionConfig;
    this.password = password;
    this.sshPassword = sshPassword;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon(this.table.type === 'view' ? 'eye' : 'table');
    item.contextValue = 'tableNode';
    item.command = {
      command: 'dbClient.openTable',
      title: 'Open Table',
      arguments: [this],
    };
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.connectionConfig, this.password, this.sshPassword);
      const columns = await driver.getColumns(this.table.name, this.connectionConfig.database, this.table.schema);
      return columns.map((col) => new ColumnNode(col, this));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch columns for table ${this.table.name}: ${err.message}`);
      return [];
    }
  }
}
