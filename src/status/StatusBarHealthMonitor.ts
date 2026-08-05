import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionStorageService } from '../storage/ConnectionStorage.js';
import { isRussian, t } from '../util/i18n.js';

export class StatusBarHealthMonitor {
  private static instance: StatusBarHealthMonitor;
  private statusBarItem: vscode.StatusBarItem;
  private activeConfig: ConnectionConfig | null = null;
  private activePassword?: string;
  private activeSshPassword?: string;
  private pingInterval?: NodeJS.Timeout;
  private storageService?: ConnectionStorageService;

  private constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'dbClient.statusBarMenu';
    this.statusBarItem.hide();
  }

  public static getInstance(): StatusBarHealthMonitor {
    if (!StatusBarHealthMonitor.instance) {
      StatusBarHealthMonitor.instance = new StatusBarHealthMonitor();
    }
    return StatusBarHealthMonitor.instance;
  }

  public init(context: vscode.ExtensionContext, storageService: ConnectionStorageService) {
    this.storageService = storageService;

    context.subscriptions.push(this.statusBarItem);

    context.subscriptions.push(
      vscode.commands.registerCommand('dbClient.statusBarMenu', async () => {
        await this.showMenu();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('dbClient.setActiveConnection', async (config: ConnectionConfig, pass?: string, sshPass?: string) => {
        await this.setActiveConnection(config, pass, sshPass);
      })
    );
  }

  public async setActiveConnection(config: ConnectionConfig, password?: string, sshPassword?: string) {
    this.activeConfig = config;
    this.activePassword = password;
    this.activeSshPassword = sshPassword;

    this.statusBarItem.show();
    await this.checkHealth();

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      this.checkHealth();
    }, 15000);
  }

  public async checkHealth() {
    if (!this.activeConfig) {
      this.statusBarItem.hide();
      return;
    }

    const startTime = Date.now();
    try {
      const driver = await DriverManager.getInstance().getDriver(this.activeConfig, this.activePassword, this.activeSshPassword);
      await driver.connect();
      const latency = Date.now() - startTime;

      const ru = isRussian();
      this.statusBarItem.text = `$(database) ${this.activeConfig.name} (${latency}ms)`;
      this.statusBarItem.tooltip = ru
        ? `Подключение: ${this.activeConfig.name}\nТип: ${this.activeConfig.type}\nЗадержка: ${latency}мс\nНажмите для меню`
        : `Connection: ${this.activeConfig.name}\nType: ${this.activeConfig.type}\nLatency: ${latency}ms\nClick for options`;
      this.statusBarItem.color = '#4ade80'; // Green
    } catch (err: any) {
      const ru = isRussian();
      this.statusBarItem.text = `$(warning) ${this.activeConfig.name} (${ru ? 'Ошибка' : 'Error'})`;
      this.statusBarItem.tooltip = `${ru ? 'Ошибка подключения' : 'Connection Error'}: ${err.message}`;
      this.statusBarItem.color = '#f87171'; // Red
    }
  }

  private async showMenu() {
    if (!this.activeConfig || !this.storageService) return;

    const ru = isRussian();
    const connections = this.storageService.getConnections();

    const items: (vscode.QuickPickItem & { action?: string; config?: ConnectionConfig })[] = [
      {
        label: `$(refresh) ${t('Check Connection Latency', 'Проверить пинг и статус')}`,
        action: 'check',
      },
      {
        label: `$(sync) ${t('Reconnect', 'Переподключиться к БД')}`,
        action: 'reconnect',
      },
      {
        label: `$(close) ${t('Disconnect Active Database', 'Отключиться от БД')}`,
        action: 'disconnect',
      },
      {
        label: '',
        kind: vscode.QuickPickItemKind.Separator,
      },
      ...connections.map((c) => ({
        label: c.id === this.activeConfig?.id ? `$(check) ${c.name}` : `$(database) ${c.name}`,
        description: `${c.type} (${c.host || 'local'})`,
        action: 'switch',
        config: c,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: t('Database Connection Manager', 'Управление подключениями к БД'),
    });

    if (!selected) return;

    if (selected.action === 'check') {
      await this.checkHealth();
    } else if (selected.action === 'reconnect') {
      await DriverManager.getInstance().removeDriver(this.activeConfig.id);
      await this.checkHealth();
      vscode.window.showInformationMessage(t(`Reconnected to ${this.activeConfig.name}`, `Переподключено к ${this.activeConfig.name}`));
    } else if (selected.action === 'disconnect') {
      await DriverManager.getInstance().removeDriver(this.activeConfig.id);
      this.activeConfig = null;
      this.statusBarItem.hide();
      if (this.pingInterval) clearInterval(this.pingInterval);
      vscode.window.showInformationMessage(t('Disconnected from active database', 'Отключено от базы данных'));
    } else if (selected.action === 'switch' && selected.config) {
      const pass = await this.storageService.getPassword(selected.config.id);
      const sshPass = await this.storageService.getSshPassword(selected.config.id);
      await this.setActiveConnection(selected.config, pass, sshPass);
      vscode.window.showInformationMessage(t(`Active database set to "${selected.config.name}"`, `Активная БД изменена на "${selected.config.name}"`));
    }
  }

  public dispose() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.statusBarItem.dispose();
  }
}
