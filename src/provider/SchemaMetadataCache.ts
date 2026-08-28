import { ConnectionStorageService } from '../storage/ConnectionStorage.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { ColumnInfo, TableInfo } from '../model/QueryTypes.js';
import { ForeignKeyInfo } from '../drivers/BaseDriver.js';

export interface CachedTableMetadata {
  table: TableInfo;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface CachedConnectionMetadata {
  connectionId: string;
  connectionName: string;
  database?: string;
  schema?: string;
  tables: Map<string, CachedTableMetadata>; // tableName (lowercase) -> metadata
}

export class SchemaMetadataCache {
  private static instance: SchemaMetadataCache;
  private cache: Map<string, CachedConnectionMetadata> = new Map();
  private storageService?: ConnectionStorageService;
  private activeConnectionId?: string;

  private constructor() {}

  public static getInstance(): SchemaMetadataCache {
    if (!SchemaMetadataCache.instance) {
      SchemaMetadataCache.instance = new SchemaMetadataCache();
    }
    return SchemaMetadataCache.instance;
  }

  public init(storageService: ConnectionStorageService): void {
    this.storageService = storageService;
  }

  public setActiveConnectionId(connectionId: string): void {
    this.activeConnectionId = connectionId;
  }

  public getActiveConnectionId(): string | undefined {
    if (this.activeConnectionId && this.cache.has(this.activeConnectionId)) {
      return this.activeConnectionId;
    }
    const first = this.cache.keys().next().value;
    return first;
  }

  public getMetadata(connectionId?: string): CachedConnectionMetadata | undefined {
    const id = connectionId || this.getActiveConnectionId();
    if (!id) return undefined;
    return this.cache.get(id);
  }

  public getAllMetadata(): CachedConnectionMetadata[] {
    return Array.from(this.cache.values());
  }

  public async refreshConnection(connectionId: string): Promise<void> {
    if (!this.storageService) return;
    const config = this.storageService.getConnections().find((c) => c.id === connectionId);
    if (!config) {
      this.cache.delete(connectionId);
      return;
    }

    try {
      const pass = await this.storageService.getPassword(config.id);
      const sshPass = await this.storageService.getSshPassword(config.id);
      const driver = await DriverManager.getInstance().getDriver(config, pass, sshPass);

      const tables = await driver.getTables(config.database, config.schema);
      const tableMap = new Map<string, CachedTableMetadata>();

      for (const tbl of tables) {
        try {
          const cols = await driver.getColumns(tbl.name, config.database, tbl.schema || config.schema);
          let fks: ForeignKeyInfo[] = [];
          try {
            fks = await driver.getForeignKeys(tbl.name, config.database, tbl.schema || config.schema);
          } catch {
            fks = [];
          }
          tableMap.set(tbl.name.toLowerCase(), {
            table: tbl,
            columns: cols,
            foreignKeys: fks,
          });
        } catch {
          // Table could not be introspected
        }
      }

      this.cache.set(connectionId, {
        connectionId: config.id,
        connectionName: config.name,
        database: config.database,
        schema: config.schema,
        tables: tableMap,
      });

      if (!this.activeConnectionId) {
        this.activeConnectionId = connectionId;
      }
    } catch {
      // Connection might be offline or credentials invalid
    }
  }

  public async refreshAll(): Promise<void> {
    if (!this.storageService) return;
    const connections = this.storageService.getConnections();
    for (const c of connections) {
      await this.refreshConnection(c.id);
    }
  }

  public clear(): void {
    this.cache.clear();
  }

  /**
   * Helper to set mock data directly for unit testing without live network connections.
   */
  public setMockMetadata(connectionId: string, metadata: CachedConnectionMetadata): void {
    this.cache.set(connectionId, metadata);
    this.activeConnectionId = connectionId;
  }
}
