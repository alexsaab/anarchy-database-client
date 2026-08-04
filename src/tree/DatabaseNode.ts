import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { TableGroupNode } from './TableGroupNode.js';
import { SchemaNode } from './SchemaNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { IconHelper } from '../util/IconHelper.js';

export class DatabaseNode extends BaseNode {
  public dbName: string;
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;

  constructor(dbName: string, connectionConfig: ConnectionConfig, password?: string, sshPassword?: string, parent?: BaseNode) {
    super(`db_${connectionConfig.id}_${dbName}`, dbName, 'databaseNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.dbName = dbName;
    this.connectionConfig = { ...connectionConfig, database: dbName };
    this.password = password;
    this.sshPassword = sshPassword;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = IconHelper.getDatabaseIcon();
    item.contextValue = 'databaseNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      if (this.connectionConfig.type === 'PostgreSQL') {
        const driver = await DriverManager.getInstance().getDriver(this.connectionConfig, this.password, this.sshPassword);
        const schemas = await driver.getSchemas(this.dbName);

        if (schemas.length > 1) {
          return schemas.map((s) => new SchemaNode(s, this.connectionConfig, this.password, this.sshPassword, this));
        } else if (schemas.length === 1) {
          return [new TableGroupNode(this.connectionConfig, this.password, this.sshPassword, schemas[0], this)];
        }
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to load schemas for database ${this.dbName}: ${e.message}`);
    }

    return [new TableGroupNode(this.connectionConfig, this.password, this.sshPassword, this.connectionConfig.schema || 'public', this)];
  }
}
