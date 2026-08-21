import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { TableNode } from './TableNode.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { ElasticsearchDriver } from '../drivers/ElasticsearchDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { AliasInfo } from '../model/QueryTypes.js';
import { isRussian, t } from '../util/i18n.js';
import { IconHelper } from '../util/IconHelper.js';

/** Elasticsearch aliases, listed alongside the concrete indices. */
export class AliasGroupNode extends BaseNode {
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;

  constructor(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string, parent?: BaseNode) {
    const ru = isRussian();
    super(
      `alias_group_${connectionConfig.id}`,
      ru ? 'Псевдонимы (Aliases)' : 'Aliases',
      'aliasGroupNode',
      vscode.TreeItemCollapsibleState.Collapsed,
      parent
    );
    this.connectionConfig = connectionConfig;
    this.password = password;
    this.sshPassword = sshPassword;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = IconHelper.getFolderIcon();
    item.contextValue = 'aliasGroupNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    try {
      const driver = await DriverManager.getInstance().getDriver(this.connectionConfig, this.password, this.sshPassword);
      if (!(driver instanceof ElasticsearchDriver)) {
        return [];
      }
      const aliases = await driver.getAliases();
      if (aliases.length === 0) {
        return [new EmptyAliasNode(this)];
      }
      return aliases.map((a) => new AliasNode(a, this.connectionConfig, this.password, this.sshPassword, this));
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to fetch aliases: ${err.message}`);
      return [];
    }
  }
}

/**
 * A single alias. Opening it queries the alias directly -- Elasticsearch
 * resolves it to its indices -- and expanding it shows what it points at.
 */
export class AliasNode extends BaseNode {
  public alias: AliasInfo;
  public connectionConfig: ConnectionConfig;
  public password?: string;
  public sshPassword?: string;

  constructor(alias: AliasInfo, connectionConfig: ConnectionConfig, password?: string, sshPassword?: string, parent?: BaseNode) {
    super(`alias_${connectionConfig.id}_${alias.name}`, alias.name, 'aliasNode', vscode.TreeItemCollapsibleState.Collapsed, parent);
    this.alias = alias;
    this.connectionConfig = connectionConfig;
    this.password = password;
    this.sshPassword = sshPassword;
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = new vscode.ThemeIcon('link', new vscode.ThemeColor('charts.blue'));
    item.contextValue = 'aliasNode';

    const count = this.alias.indices.length;
    const parts = [count === 1 ? this.alias.indices[0] : t(`${count} indices`, `индексов: ${count}`)];
    if (this.alias.filtered) {
      parts.push(t('filtered', 'с фильтром'));
    }
    item.description = `→ ${parts.join(' · ')}`;

    item.tooltip = new vscode.MarkdownString(
      `**${t('Alias', 'Псевдоним')}** \`${this.alias.name}\`\n\n` +
        this.alias.indices.map((i) => `- \`${i}\`${i === this.alias.writeIndex ? ' _(write index)_' : ''}`).join('\n') +
        (this.alias.filtered ? `\n\n_${t('This alias applies a filter.', 'Псевдоним применяет фильтр.')}_` : '')
    );

    // Aliases are queryable exactly like an index.
    item.command = {
      command: 'dbClient.openTable',
      title: 'Open Alias',
      arguments: [
        new TableNode(
          { name: this.alias.name, type: 'view' },
          this.connectionConfig,
          this.password,
          this.sshPassword,
          this.parent
        ),
      ],
    };
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    return this.alias.indices.map(
      (indexName) =>
        new TableNode(
          { name: indexName, type: 'table' },
          this.connectionConfig,
          this.password,
          this.sshPassword,
          this
        )
    );
  }
}

class EmptyAliasNode extends BaseNode {
  constructor(parent?: BaseNode) {
    super('alias_empty', '', 'aliasEmptyNode', vscode.TreeItemCollapsibleState.None, parent);
  }

  getTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(t('No aliases defined', 'Псевдонимы не найдены'));
    item.iconPath = new vscode.ThemeIcon('info');
    item.contextValue = 'aliasEmptyNode';
    return item;
  }

  async getChildren(): Promise<BaseNode[]> {
    return [];
  }
}
