import * as vscode from 'vscode';
import { BaseNode } from './BaseNode.js';
import { ConnectionNode } from './ConnectionNode.js';
import { GroupNode } from './GroupNode.js';
import { ConnectionStorageService } from '../storage/ConnectionStorage.js';

export class DatabaseTreeProvider implements vscode.TreeDataProvider<BaseNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<BaseNode | undefined | void> = new vscode.EventEmitter<BaseNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<BaseNode | undefined | void> = this._onDidChangeTreeData.event;

  private storageService: ConnectionStorageService;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, storageService: ConnectionStorageService) {
    this.context = context;
    this.storageService = storageService;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BaseNode): vscode.TreeItem | Promise<vscode.TreeItem> {
    return element.getTreeItem();
  }

  async getChildren(element?: BaseNode): Promise<BaseNode[]> {
    if (!element) {
      const profiles = this.storageService.getConnections();
      const connectionNodes: ConnectionNode[] = [];

      for (const p of profiles) {
        const pass = await this.storageService.getPassword(p.id);
        const sshPass = await this.storageService.getSshPassword(p.id);
        connectionNodes.push(new ConnectionNode(p, this.context, pass, sshPass));
      }

      // Group connections if any connection has a group set
      const hasGroups = connectionNodes.some((node) => node.config.group && node.config.group.trim() !== '');

      if (!hasGroups) {
        return connectionNodes;
      }

      const groupsMap = new Map<string, ConnectionNode[]>();
      const rootNodes: ConnectionNode[] = [];

      for (const node of connectionNodes) {
        const gName = node.config.group ? node.config.group.trim() : '';
        if (gName) {
          if (!groupsMap.has(gName)) {
            groupsMap.set(gName, []);
          }
          groupsMap.get(gName)!.push(node);
        } else {
          rootNodes.push(node);
        }
      }

      const resultNodes: BaseNode[] = [];

      for (const [groupName, nodes] of groupsMap.entries()) {
        resultNodes.push(new GroupNode(groupName, nodes));
      }

      return [...resultNodes, ...rootNodes];
    }

    return element.getChildren();
  }
}
