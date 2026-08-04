import * as vscode from 'vscode';
import * as fs from 'fs';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { t } from '../util/i18n.js';

export class DatabaseDumpService {
  public static async dumpDatabase(config: ConnectionConfig, password?: string, sshPassword?: string) {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${config.database || config.name}_dump.sql`),
      filters: { 'SQL Files': ['sql'] },
      saveLabel: t('Export SQL Dump', 'Экспортировать дамп SQL'),
    });

    if (!saveUri) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t(`Exporting SQL dump for ${config.name}...`, `Экспорт дампа SQL для ${config.name}...`),
        cancellable: false,
      },
      async () => {
        try {
          const driver = await DriverManager.getInstance().getDriver(config, password, sshPassword);
          const tables = await driver.getTables(config.database);

          let sqlDump = `-- Anarchy DB Client SQL Dump\n-- Database: ${config.database || config.name}\n-- Date: ${new Date().toISOString()}\n\n`;

          for (const tbl of tables) {
            sqlDump += `-- Table structure for "${tbl.name}"\n`;
            const columns = await driver.getColumns(tbl.name, config.database, tbl.schema);

            sqlDump += `DROP TABLE IF EXISTS "${tbl.name}";\nCREATE TABLE "${tbl.name}" (\n`;
            const colDefs = columns.map(
              (c) => `  "${c.name}" ${c.type}${c.isPrimaryKey ? ' PRIMARY KEY' : ''}${c.nullable ? '' : ' NOT NULL'}${c.defaultValue ? ` DEFAULT ${c.defaultValue}` : ''}`
            );
            sqlDump += colDefs.join(',\n');
            sqlDump += '\n);\n\n';

            // Dump Table Rows
            const rowData = await driver.getTableData(tbl.name, { page: 1, pageSize: 500 }, tbl.schema);
            if (rowData.rows && rowData.rows.length > 0) {
              sqlDump += `-- Dumping data for "${tbl.name}"\n`;
              for (const row of rowData.rows) {
                const colNames = rowData.fields.map((f) => `"${f.name}"`).join(', ');
                const valStrings = rowData.fields.map((f) => {
                  const val = row[f.name];
                  if (val === null || val === undefined) return 'NULL';
                  if (typeof val === 'number') return val;
                  return `'${String(val).replace(/'/g, "''")}'`;
                }).join(', ');
                sqlDump += `INSERT INTO "${tbl.name}" (${colNames}) VALUES (${valStrings});\n`;
              }
              sqlDump += '\n';
            }
          }

          fs.writeFileSync(saveUri.fsPath, sqlDump, 'utf8');
          vscode.window.showInformationMessage(
            t(`SQL Dump exported successfully to ${saveUri.fsPath}!`, `Дамп SQL успешно экспортирован в ${saveUri.fsPath}!`)
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Dump failed: ${err.message}`);
        }
      }
    );
  }

  public static async importSqlFile(config: ConnectionConfig, password?: string, sshPassword?: string) {
    const openUris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'SQL Files': ['sql'] },
      openLabel: t('Import SQL File', 'Импортировать файл SQL'),
    });

    if (!openUris || openUris.length === 0) {
      return;
    }

    const filePath = openUris[0].fsPath;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t(`Importing SQL file into ${config.name}...`, `Импорт файла SQL в ${config.name}...`),
        cancellable: false,
      },
      async () => {
        try {
          const sqlContent = fs.readFileSync(filePath, 'utf8');
          const driver = await DriverManager.getInstance().getDriver(config, password, sshPassword);

          // Split queries by semicolon
          const queries = sqlContent
            .split(';')
            .map((q) => q.trim())
            .filter((q) => q.length > 0);

          for (const q of queries) {
            await driver.executeQuery(q);
          }

          vscode.window.showInformationMessage(
            t(`Successfully executed ${queries.length} queries from ${filePath}!`, `Успешно выполнено ${queries.length} запросов из ${filePath}!`)
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Import failed: ${err.message}`);
        }
      }
    );
  }
}
