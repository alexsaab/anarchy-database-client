import * as net from 'net';
import * as fs from 'fs';
import { Client } from 'ssh2';
import { ConnectionConfig } from '../model/ConnectionConfig.js';

export interface SshTunnelResult {
  server: net.Server;
  localPort: number;
}

export class SshTunnelManager {
  public static async createTunnel(config: ConnectionConfig, sshPassword?: string): Promise<SshTunnelResult> {
    if (!config.ssh || !config.ssh.enabled) {
      throw new Error('SSH is not enabled for this connection');
    }

    const sshHost = config.ssh.host;
    const sshPort = config.ssh.port || 22;
    const sshUser = config.ssh.username;

    if (!sshHost || !sshUser) {
      throw new Error('SSH Host and Username are required');
    }

    return new Promise((resolve, reject) => {
      const sshClient = new Client();

      const server = net.createServer((localSocket) => {
        sshClient.forwardOut(
          '127.0.0.1',
          localSocket.remotePort || 0,
          config.host || 'localhost',
          config.port || 3306,
          (err, stream) => {
            if (err) {
              localSocket.destroy();
              return;
            }
            localSocket.pipe(stream).pipe(localSocket);
          }
        );
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        const localPort = address.port;

        const connectConfig: any = {
          host: sshHost,
          port: sshPort,
          username: sshUser,
        };

        if (config.ssh?.usePrivateKey && config.ssh?.privateKeyPath) {
          try {
            connectConfig.privateKey = fs.readFileSync(config.ssh.privateKeyPath);
          } catch (e: any) {
            server.close();
            return reject(new Error(`Failed to read private key file: ${e.message}`));
          }
        } else if (sshPassword) {
          connectConfig.password = sshPassword;
        }

        sshClient
          .on('ready', () => {
            resolve({ server, localPort });
          })
          .on('error', (err) => {
            server.close();
            reject(new Error(`SSH Tunnel connection error: ${err.message}`));
          })
          .connect(connectConfig);
      });

      server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public static async closeTunnel(result: SshTunnelResult): Promise<void> {
    return new Promise((resolve) => {
      result.server.close(() => resolve());
    });
  }
}
