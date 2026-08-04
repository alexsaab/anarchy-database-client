import { BaseDriver } from './BaseDriver.js';
import { PostgresDriver } from './PostgresDriver.js';
import { MysqlDriver } from './MysqlDriver.js';
import { SqliteDriver } from './SqliteDriver.js';
import { RedisDriver } from './RedisDriver.js';
import { MongoDriver } from './MongoDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { SshTunnelManager, SshTunnelResult } from '../ssh/SshTunnelManager.js';

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
        case 'SQLite':
          driver = new SqliteDriver(finalConfig, password);
          break;
        case 'Redis':
          driver = new RedisDriver(finalConfig, password);
          break;
        case 'MongoDB':
          driver = new MongoDriver(finalConfig, password);
          break;
        default:
          throw new Error(`Unsupported database type: ${config.type}`);
      }
      this.activeDrivers.set(driverKey, driver);
    }
    return driver;
  }

  public async disconnectAll(): Promise<void> {
    for (const [key, driver] of this.activeDrivers.entries()) {
      await driver.disconnect();
    }
    this.activeDrivers.clear();

    for (const [id, tunnel] of this.sshTunnels.entries()) {
      tunnel.close();
    }
    this.sshTunnels.clear();
  }

  public async removeDriver(id: string): Promise<void> {
    for (const [key, driver] of this.activeDrivers.entries()) {
      if (key.startsWith(id)) {
        await driver.disconnect();
        this.activeDrivers.delete(key);
      }
    }
    const tunnel = this.sshTunnels.get(id);
    if (tunnel) {
      tunnel.close();
      this.sshTunnels.delete(id);
    }
  }
}
