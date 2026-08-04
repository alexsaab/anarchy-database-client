import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { ScriptNode } from './ScriptNode.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian } from '../util/i18n.js';

export class TriggerGroupNode extends BaseNode {
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;
  public schemaName?: string;

  constructor(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string, schemaName?: string, parent?: BaseNode) {
    const label = isRussian() ? 'Триггеры (Triggers)' : 'Triggers';
    super(`triggers_${connectionConfig.id}_${schemaName || 'main'}`, label, 'triggerGroupNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.connectionConfig = connectionConfig;
    this.password = password;
    this.sshPassword = sshPassword;
    this.schemaName = schemaName;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon('zap');
    item.contextValue = 'triggerGroupNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.connectionConfig, this.password, this.sshPassword);
      const triggers = await driver.getTriggers(this.connectionConfig.database, this.schemaName);
      return triggers.map((t) => new ScriptNode(t.name, 'trigger', this.connectionConfig, this.password, this.sshPassword, this.schemaName, this));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch triggers: ${err.message}`);
      return [];
    }
  }
}
