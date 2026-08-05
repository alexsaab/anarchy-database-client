import * as path from 'path';
import * as vscode from 'vscode';
import { DatabaseType } from '../model/ConnectionConfig.js';

export class IconHelper {
  private static extensionPath: string = '';

  public static setExtensionPath(extPath: string) {
    IconHelper.extensionPath = extPath;
  }

  private static getResourcePath(relativePath: string): vscode.Uri {
    const basePath = IconHelper.extensionPath || path.join(__dirname, '..');
    return vscode.Uri.file(path.join(basePath, 'resources', relativePath));
  }

  public static getConnectionIcon(type: DatabaseType, isConnected: boolean = false): vscode.Uri {
    let iconName = 'database.svg';

    switch (type) {
      case 'PostgreSQL':
        iconName = isConnected ? 'server/postgresql_active.svg' : 'server/postgresql.svg';
        break;
      case 'MySQL':
        iconName = isConnected ? 'server/mysql_active.svg' : 'server/mysql.svg';
        break;
      case 'SQLite':
        iconName = isConnected ? 'server/sqlite_active.svg' : 'server/sqlite.svg';
        break;
      case 'Redis':
        iconName = isConnected ? 'server/redis.svg' : 'server/redis.svg';
        break;
      case 'MongoDB':
        iconName = isConnected ? 'server/mongodb_active.svg' : 'server/mongodb.svg';
        break;
      case 'Elasticsearch':
        iconName = isConnected ? 'server/elasticsearch_active.svg' : 'server/elasticsearch.svg';
        break;
      case 'ClickHouse':
        iconName = isConnected ? 'server/clickhouse_active.svg' : 'server/clickhouse.svg';
        break;
      case 'CouchDB':
      case 'Couchbase':
      case 'Firestore':
        iconName = 'server/database.svg';
        break;
      default:
        iconName = 'server/db2.svg';
        break;
    }

    return IconHelper.getResourcePath(`icon/${iconName}`);
  }

  public static getDatabaseIcon(): vscode.Uri {
    return IconHelper.getResourcePath('icon/database.svg');
  }

  public static getSchemaIcon(): vscode.Uri {
    return IconHelper.getResourcePath('icon/layer-group.svg');
  }

  public static getFolderIcon(): vscode.Uri {
    return IconHelper.getResourcePath('icon/folder.svg');
  }

  public static getQueryIcon(): vscode.Uri {
    return IconHelper.getResourcePath('icon/webview/query.svg');
  }

  public static getColorBadge(color?: string): string {
    if (!color || color === 'default') return '';
    const c = color.toLowerCase();
    if (c.includes('ef4444') || c.includes('f87171') || c === 'red') return '🔴';
    if (c.includes('10b981') || c.includes('4ade80') || c === 'green') return '🟢';
    if (c.includes('f59e0b') || c.includes('fbbf24') || c === 'yellow') return '🟡';
    if (c.includes('3b82f6') || c.includes('60a5fa') || c === 'blue') return '🔵';
    if (c.includes('8b5cf6') || c.includes('a78bfa') || c === 'purple') return '🟣';
    if (c.includes('ec4899') || c.includes('f472b6') || c === 'pink') return '🩷';
    if (c === 'orange') return '🟠';
    return '🟢';
  }

  public static getThemeColor(color?: string): vscode.ThemeColor | undefined {
    if (!color || color === 'default') return undefined;
    const c = color.toLowerCase();
    if (c.includes('ef4444') || c.includes('f87171') || c === 'red') return new vscode.ThemeColor('charts.red');
    if (c.includes('10b981') || c.includes('4ade80') || c === 'green') return new vscode.ThemeColor('charts.green');
    if (c.includes('f59e0b') || c.includes('fbbf24') || c === 'yellow') return new vscode.ThemeColor('charts.yellow');
    if (c.includes('3b82f6') || c.includes('60a5fa') || c === 'blue') return new vscode.ThemeColor('charts.blue');
    if (c.includes('8b5cf6') || c.includes('a78bfa') || c === 'purple') return new vscode.ThemeColor('charts.purple');
    if (c.includes('ec4899') || c.includes('f472b6') || c === 'pink') return new vscode.ThemeColor('charts.orange');
    if (c === 'orange') return new vscode.ThemeColor('charts.orange');
    return undefined;
  }
}
