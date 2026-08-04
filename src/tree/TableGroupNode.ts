import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { TableNode } from './TableNode.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { isRussian } from '../util/i18n.js';
import { IconHelper } from '../util/IconHelper.js';

export class TableGroupNode extends BaseNode {
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;
  public schemaName: string;

  constructor(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string, schemaName: string = 'public', parent?: BaseNode) {
    const ru = isRussian();
    const type = connectionConfig.type;

    let label = ru ? 'Таблицы (Tables)' : 'Tables';
    if (type === 'MongoDB' || type === 'CouchDB' || type === 'Couchbase' || type === 'Firestore') {
      label = ru ? 'Коллекции (Collections)' : 'Collections';
    } else if (type === 'Elasticsearch') {
      label = ru ? 'Индексы (Indices)' : 'Indices';
    }

    super(`table_group_${connectionConfig.id}_${schemaName}`, label, 'tableGroupNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.connectionConfig = connectionConfig;
    this.password = password;
    this.sshPassword = sshPassword;
    this.schemaName = schemaName;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = IconHelper.getFolderIcon();
    item.contextValue = 'tableGroupNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.connectionConfig, this.password, this.sshPassword);
      const tables = await driver.getTables(this.connectionConfig.database, this.schemaName);
      return tables.map((tbl) => new TableNode(tbl, this.connectionConfig, this.password, this.sshPassword, this));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch tables: ${err.message}`);
      return [];
    }
  }
}
