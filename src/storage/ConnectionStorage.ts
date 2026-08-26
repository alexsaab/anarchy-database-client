import * as vscode from 'vscode';
import { ConnectionConfig, SavedConnectionProfile } from '../model/ConnectionConfig.js';

export class ConnectionStorageService {
  private static readonly STORAGE_KEY = 'database_client_connections';
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public getConnections(): SavedConnectionProfile[] {
    return this.context.globalState.get<SavedConnectionProfile[]>(ConnectionStorageService.STORAGE_KEY, []);
  }

  public getConnectionById(id: string): SavedConnectionProfile | undefined {
    return this.getConnections().find((c) => c.id === id);
  }

  public async saveConnection(config: ConnectionConfig, password?: string, sshPassword?: string): Promise<SavedConnectionProfile> {
    const connections = this.getConnections();
    const existingIndex = connections.findIndex((c) => c.id === config.id);

    const profile: SavedConnectionProfile = {
      id: config.id || `conn_${Date.now()}`,
      name: config.name,
      group: config.group,
      color: config.color,
      type: config.type,
      host: config.host,
      port: config.port,
      user: config.user,
      database: config.database,
      schema: config.schema,
      dbPath: config.dbPath,
      ssl: config.ssl,
      ssh: config.ssh,
    };

    if (password !== undefined && password !== '') {
      await this.context.secrets.store(`password_${profile.id}`, password);
    }

    if (sshPassword !== undefined && sshPassword !== '') {
      await this.context.secrets.store(`ssh_password_${profile.id}`, sshPassword);
    }

    if (existingIndex >= 0) {
      connections[existingIndex] = profile;
    } else {
      connections.push(profile);
    }

    await this.context.globalState.update(ConnectionStorageService.STORAGE_KEY, connections);
    return profile;
  }

  public async getPassword(id: string): Promise<string | undefined> {
    return await this.context.secrets.get(`password_${id}`);
  }

  public async savePassword(id: string, password: string): Promise<void> {
    if (password !== undefined && password !== '') {
      await this.context.secrets.store(`password_${id}`, password);
    }
  }

  public async getSshPassword(id: string): Promise<string | undefined> {
    return await this.context.secrets.get(`ssh_password_${id}`);
  }

  public async saveSshPassword(id: string, password: string): Promise<void> {
    if (password !== undefined && password !== '') {
      await this.context.secrets.store(`ssh_password_${id}`, password);
    }
  }

  public async deleteConnection(id: string): Promise<void> {
    const connections = this.getConnections().filter((c) => c.id !== id);
    await this.context.globalState.update(ConnectionStorageService.STORAGE_KEY, connections);
    await this.context.secrets.delete(`password_${id}`);
    await this.context.secrets.delete(`ssh_password_${id}`);
  }

  public async cloneConnection(sourceId: string, customName?: string): Promise<SavedConnectionProfile | undefined> {
    const source = this.getConnectionById(sourceId);
    if (!source) {
      return undefined;
    }

    const connections = this.getConnections();
    let newName = customName;
    if (!newName) {
      const baseName = source.name;
      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const copyPattern = new RegExp(`^${escapedBase} \\(Copy(?: (\\d+))?\\)$`);
      let maxCopyNum = 0;
      let hasPlainCopy = false;

      for (const conn of connections) {
        if (conn.name === `${baseName} (Copy)`) {
          hasPlainCopy = true;
        } else {
          const match = conn.name.match(copyPattern);
          if (match && match[1]) {
            const num = parseInt(match[1], 10);
            if (num > maxCopyNum) {
              maxCopyNum = num;
            }
          }
        }
      }

      if (!hasPlainCopy && maxCopyNum === 0) {
        newName = `${baseName} (Copy)`;
      } else {
        newName = `${baseName} (Copy ${Math.max(maxCopyNum + 1, 2)})`;
      }
    }

    const newId = `conn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const clonedConfig: ConnectionConfig = {
      ...JSON.parse(JSON.stringify(source)),
      id: newId,
      name: newName,
    };

    const password = await this.getPassword(source.id);
    const sshPassword = await this.getSshPassword(source.id);

    return await this.saveConnection(clonedConfig, password, sshPassword);
  }
}

