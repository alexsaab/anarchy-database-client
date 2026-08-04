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

  public static getGroupIcon(): vscode.ThemeIcon {
    return new vscode.ThemeIcon('folder');
  }
}
