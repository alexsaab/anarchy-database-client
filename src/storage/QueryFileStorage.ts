import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface QueryFileItem {
  name: string;
  filePath: string;
}

export class QueryFileStorage {
  private static getStorageDir(context: vscode.ExtensionContext, connectionId: string, dbName?: string): string {
    const base = context.globalStorageUri.fsPath;
    const dbSub = dbName || 'default';
    const dir = path.join(base, 'queries', connectionId, dbSub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public static getBoundFolder(context: vscode.ExtensionContext, connectionId: string, dbName?: string): string | undefined {
    const key = `queryFolder_${connectionId}_${dbName || 'default'}`;
    return context.globalState.get<string>(key);
  }

  public static async setBoundFolder(context: vscode.ExtensionContext, connectionId: string, folderPath: string, dbName?: string): Promise<void> {
    const key = `queryFolder_${connectionId}_${dbName || 'default'}`;
    await context.globalState.update(key, folderPath);
  }

  public static getQueryFiles(context: vscode.ExtensionContext, connectionId: string, dbName?: string): QueryFileItem[] {
    const boundFolder = QueryFileStorage.getBoundFolder(context, connectionId, dbName);
    const targetDir = (boundFolder && fs.existsSync(boundFolder))
      ? boundFolder
      : QueryFileStorage.getStorageDir(context, connectionId, dbName);

    if (!fs.existsSync(targetDir)) return [];

    try {
      const files = fs.readdirSync(targetDir);
      return files
        .filter((f) => f.endsWith('.sql'))
        .map((f) => ({
          name: f,
          filePath: path.join(targetDir, f),
        }));
    } catch (e) {
      return [];
    }
  }

  public static async createQueryFile(context: vscode.ExtensionContext, connectionId: string, fileName: string, dbName?: string): Promise<string> {
    const safeName = fileName.endsWith('.sql') ? fileName : `${fileName}.sql`;
    const boundFolder = QueryFileStorage.getBoundFolder(context, connectionId, dbName);
    const targetDir = (boundFolder && fs.existsSync(boundFolder))
      ? boundFolder
      : QueryFileStorage.getStorageDir(context, connectionId, dbName);

    const fullPath = path.join(targetDir, safeName);
    if (!fs.existsSync(fullPath)) {
      const initialComment = `-- Saved Query: ${safeName}\n-- Database: ${dbName || 'default'}\n\nSELECT 1;\n`;
      fs.writeFileSync(fullPath, initialComment, 'utf8');
    }
    return fullPath;
  }

  public static deleteQueryFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  public static renameQueryFile(oldPath: string, newName: string): string {
    const dir = path.dirname(oldPath);
    const safeName = newName.endsWith('.sql') ? newName : `${newName}.sql`;
    const newPath = path.join(dir, safeName);
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
    }
    return newPath;
  }
}
