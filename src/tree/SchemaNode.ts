import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { TableGroupNode } from './TableGroupNode.js';
import { ViewGroupNode } from './ViewGroupNode.js';
import { FunctionGroupNode } from './FunctionGroupNode.js';
import { ProcedureGroupNode } from './ProcedureGroupNode.js';
import { TriggerGroupNode } from './TriggerGroupNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { IconHelper } from '../util/IconHelper.js';

export class SchemaNode extends BaseNode {
  public schemaName: string;
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;
  public context: vscode.ExtensionContext;

  constructor(schemaName: string, connectionConfig: ConnectionConfig, context: vscode.ExtensionContext, password?: string, sshPassword?: string, parent?: BaseNode) {
    super(`schema_${connectionConfig.id}_${connectionConfig.database}_${schemaName}`, schemaName, 'schemaNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.schemaName = schemaName;
    this.connectionConfig = connectionConfig;
    this.context = context;
    this.password = password;
    this.sshPassword = sshPassword;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = IconHelper.getSchemaIcon();
    item.contextValue = 'schemaNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    const dbType = this.connectionConfig.type;

    if (dbType === 'MongoDB' || dbType === 'CouchDB' || dbType === 'Couchbase' || dbType === 'Firestore') {
      return [
        new TableGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
      ];
    }

    if (dbType === 'Elasticsearch') {
      return [
        new TableGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
        new ViewGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
      ];
    }

    if (dbType === 'SQLite') {
      return [
        new TableGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
        new ViewGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
        new TriggerGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
      ];
    }

    return [
      new TableGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
      new ViewGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
      new FunctionGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
      new ProcedureGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
      new TriggerGroupNode(this.connectionConfig, this.password, this.sshPassword, this.schemaName, this),
    ];
  }
}
