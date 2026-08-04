import * as vscode from 'vscode';
import { DriverManager } from '../drivers/DriverManager.js';
import { TableNode } from '../tree/TableNode.js';
import { ColumnInfo } from '../model/QueryTypes.js';
import { t } from '../util/i18n.js';

export class MockDataGenerator {
  public static async generateForTable(tableNode: TableNode) {
    const countInput = await vscode.window.showInputBox({
      prompt: t('Enter number of mock rows to generate (1 - 500):', 'Введите количество фейковых строк (1 - 500):'),
      value: '50',
      validateInput: (val) => {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1 || num > 500) {
          return t('Please enter a valid number between 1 and 500', 'Введите число от 1 до 500');
        }
        return null;
      },
    });

    if (!countInput) {
      return;
    }

    const count = parseInt(countInput, 10);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t(`Generating ${count} mock rows for "${tableNode.table.name}"...`, `Генерация ${count} фейковых строк для "${tableNode.table.name}"...`),
        cancellable: false,
      },
      async () => {
        try {
          const driver = await DriverManager.getInstance().getDriver(
            tableNode.connectionConfig,
            tableNode.password,
            tableNode.sshPassword
          );

          const columns = await driver.getColumns(
            tableNode.table.name,
            tableNode.connectionConfig.database,
            tableNode.table.schema
          );

          // Filter out auto-incrementing primary keys if possible
          const insertCols = columns.filter((c) => !c.isPrimaryKey || !c.name.includes('id'));

          for (let i = 0; i < count; i++) {
            const values = insertCols.map((col) => MockDataGenerator.generateMockValue(col, i));
            const colNames = insertCols.map((c) => `"${c.name}"`).join(', ');
            const valStrings = values.map((v) => (v === null ? 'NULL' : typeof v === 'number' ? v : `'${v}'`)).join(', ');

            const sql = `INSERT INTO "${tableNode.table.name}" (${colNames}) VALUES (${valStrings});`;
            await driver.executeQuery(sql);
          }

          vscode.window.showInformationMessage(
            t(`Successfully inserted ${count} mock rows into "${tableNode.table.name}"!`, `Успешно добавлено ${count} фейковых строк в "${tableNode.table.name}"!`)
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Mock generation failed: ${err.message}`);
        }
      }
    );
  }

  private static generateMockValue(col: ColumnInfo, index: number): any {
    const colName = col.name.toLowerCase();
    const type = col.type.toLowerCase();

    if (colName.includes('email')) {
      return `user_${index + 100}@example.com`;
    }
    if (colName.includes('name') || colName.includes('user')) {
      const names = ['Alex', 'Dmitry', 'Elena', 'Maria', 'Sergey', 'Anna', 'Ivan', 'Olga'];
      return `${names[index % names.length]}_${index + 1}`;
    }
    if (colName.includes('phone')) {
      return `+7999${String(1000000 + index).slice(1)}`;
    }
    if (colName.includes('status')) {
      return index % 2 === 0 ? 'active' : 'pending';
    }
    if (colName.includes('price') || colName.includes('amount') || colName.includes('cost')) {
      return parseFloat((Math.random() * 500 + 10).toFixed(2));
    }
    if (type.includes('int') || type.includes('number')) {
      return index + 1;
    }
    if (type.includes('bool')) {
      return index % 2 === 0;
    }
    if (type.includes('date') || type.includes('time')) {
      return new Date(Date.now() - index * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    }

    return `Sample_${col.name}_${index + 1}`;
  }
}
