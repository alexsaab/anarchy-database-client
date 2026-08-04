import * as net from 'net';
import * as fs from 'fs';
import { Client, ConnectConfig } from 'ssh2';
import { ConnectionConfig } from '../model/ConnectionConfig.js';

export interface SshTunnelResult {
  localPort: number;
  close: () => void;
}

export class SshTunnelManager {
  public static async createTunnel(
    config: ConnectionConfig,
    sshPassword?: string
  ): Promise<SshTunnelResult> {
    if (!config.ssh || !config.ssh.enabled) {
      throw new Error('SSH is not enabled in configuration');
    }

    const sshClient = new Client();

    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        sshClient.forwardOut(
          '127.0.0.1',
          socket.remotePort || 0,
          config.host || '127.0.0.1',
          config.port || 3306,
          (err, stream) => {
            if (err) {
              socket.end();
              return;
            }
            socket.pipe(stream).pipe(socket);
          }
        );
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        const localPort = address.port;

        const sshConnectOpts: ConnectConfig = {
          host: config.ssh?.host || '',
          port: config.ssh?.port || 22,
          username: config.ssh?.username || '',
          readyTimeout: 20000,
          keepaliveInterval: 10000,
        };

        if (config.ssh?.usePrivateKey && config.ssh.privateKeyPath) {
          try {
            sshConnectOpts.privateKey = fs.readFileSync(config.ssh.privateKeyPath);
            if (sshPassword) {
              sshConnectOpts.passphrase = sshPassword;
            }
          } catch (e: any) {
            server.close();
            return reject(new Error(`Failed to read SSH Private Key at "${config.ssh.privateKeyPath}": ${e.message}`));
          }
        } else {
          sshConnectOpts.password = sshPassword || '';
          sshConnectOpts.tryKeyboard = true;
        }

        sshClient
          .on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
            finish([sshPassword || '']);
          })
          .on('ready', () => {
            resolve({
              localPort,
              close: () => {
                server.close();
                sshClient.end();
              },
            });
          })
          .on('error', (err) => {
            server.close();
            reject(new Error(`SSH Tunnel Error: ${err.message}`));
          })
          .connect(sshConnectOpts);
      });
    });
  }
}
