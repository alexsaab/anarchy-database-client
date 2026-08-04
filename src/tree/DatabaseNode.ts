import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { TableGroupNode } from './TableGroupNode.js';
import { ViewGroupNode } from './ViewGroupNode.js';
import { FunctionGroupNode } from './FunctionGroupNode.js';
import { ProcedureGroupNode } from './ProcedureGroupNode.js';
import { TriggerGroupNode } from './TriggerGroupNode.js';
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
        }
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to load schemas for database ${this.dbName}: ${e.message}`);
    }

    const schema = this.connectionConfig.schema || 'public';
    return [
      new TableGroupNode(this.connectionConfig, this.password, this.sshPassword, schema, this),
      new ViewGroupNode(this.connectionConfig, this.password, this.sshPassword, schema, this),
      new FunctionGroupNode(this.connectionConfig, this.password, this.sshPassword, schema, this),
      new ProcedureGroupNode(this.connectionConfig, this.password, this.sshPassword, schema, this),
      new TriggerGroupNode(this.connectionConfig, this.password, this.sshPassword, schema, this),
    ];
  }
}
