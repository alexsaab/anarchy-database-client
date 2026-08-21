import { BaseDriver } from './BaseDriver.js';
import { PostgresDriver } from './PostgresDriver.js';
import { MysqlDriver } from './MysqlDriver.js';
import { MssqlDriver } from './MssqlDriver.js';
import { SqliteDriver } from './SqliteDriver.js';
import { RedisDriver } from './RedisDriver.js';
import { MongoDriver } from './MongoDriver.js';
import { ElasticsearchDriver } from './ElasticsearchDriver.js';
import { ClickhouseDriver } from './ClickhouseDriver.js';
import { CouchdbDriver } from './CouchdbDriver.js';
import { CouchbaseDriver } from './CouchbaseDriver.js';
import { FirestoreDriver } from './FirestoreDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { SshTunnelManager, SshTunnelResult } from '../ssh/SshTunnelManager.js';
import { ConnectionState } from './ConnectionState.js';

export class DriverManager {
  private static instance: DriverManager;
  private activeDrivers: Map<string, BaseDriver> = new Map();
  private sshTunnels: Map<string, SshTunnelResult> = new Map();

  private constructor() {}

  public static getInstance(): DriverManager {
    if (!DriverManager.instance) {
      DriverManager.instance = new DriverManager();
    }
    return DriverManager.instance;
  }

  public async getDriver(config: ConnectionConfig, password?: string, sshPassword?: string): Promise<BaseDriver> {
    const driverKey = `${config.id}_${config.database || ''}`;
    let driver = this.activeDrivers.get(driverKey);
    if (driver) {
      try {
        await driver.connect();
      } catch (e: any) {
        ConnectionState.getInstance().markLost(config.id, e?.message);
        await driver.disconnect().catch(() => {});
        this.activeDrivers.delete(driverKey);
        driver = undefined;
      }
    }

    if (!driver) {
      let finalConfig = { ...config };

      if (config.ssh && config.ssh.enabled) {
        let tunnel = this.sshTunnels.get(config.id);
        if (!tunnel) {
          tunnel = await SshTunnelManager.createTunnel(config, sshPassword);
          this.sshTunnels.set(config.id, tunnel);
        }
        finalConfig.host = '127.0.0.1';
        finalConfig.port = tunnel.localPort;
      }

      switch (config.type) {
        case 'PostgreSQL':
          driver = new PostgresDriver(finalConfig, password);
          break;
        case 'MySQL':
          driver = new MysqlDriver(finalConfig, password);
          break;
        case 'SQLServer':
          driver = new MssqlDriver(finalConfig, password);
          break;
        case 'SQLite':
          driver = new SqliteDriver(finalConfig, password);
          break;
        case 'Redis':
          driver = new RedisDriver(finalConfig, password);
          break;
        case 'MongoDB':
          driver = new MongoDriver(finalConfig, password);
          break;
        case 'Elasticsearch':
          driver = new ElasticsearchDriver(finalConfig, password);
          break;
        case 'ClickHouse':
          driver = new ClickhouseDriver(finalConfig, password);
          break;
        case 'CouchDB':
          driver = new CouchdbDriver(finalConfig, password);
          break;
        case 'Couchbase':
          driver = new CouchbaseDriver(finalConfig, password);
          break;
        case 'Firestore':
          driver = new FirestoreDriver(finalConfig, password);
          break;
        default:
          throw new Error(`Unsupported database type: ${config.type}`);
      }

      try {
        await driver.connect();
      } catch (err: any) {
        ConnectionState.getInstance().markLost(config.id, err?.message);
        throw err;
      }
      this.activeDrivers.set(driverKey, driver);
    }

    ConnectionState.getInstance().markConnected(config.id);
    return driver;
  }

  /**
   * Drops every cached driver (and any SSH tunnel) for a connection and opens a
   * fresh one, so a dead session is never reused.
   */
  public async reconnect(config: ConnectionConfig, password?: string, sshPassword?: string): Promise<BaseDriver> {
    await this.removeDriver(config.id);
    return this.getDriver(config, password, sshPassword);
  }

  public async removeDriver(configId: string): Promise<void> {
    for (const [key, driver] of this.activeDrivers.entries()) {
      if (key.startsWith(`${configId}_`)) {
        await driver.disconnect();
        this.activeDrivers.delete(key);
      }
    }

    const tunnel = this.sshTunnels.get(configId);
    if (tunnel) {
      await SshTunnelManager.closeTunnel(tunnel);
      this.sshTunnels.delete(configId);
    }

    ConnectionState.getInstance().markIdle(configId);
  }

  public async disconnectAll(): Promise<void> {
    for (const driver of this.activeDrivers.values()) {
      await driver.disconnect();
    }
    this.activeDrivers.clear();

    for (const tunnel of this.sshTunnels.values()) {
      await SshTunnelManager.closeTunnel(tunnel);
    }
    this.sshTunnels.clear();
  }
}
