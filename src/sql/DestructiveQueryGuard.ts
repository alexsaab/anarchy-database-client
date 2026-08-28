import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { isRussian, t } from '../util/i18n.js';

export interface DestructiveCheckResult {
  isDestructive: boolean;
  reason?: string;
  isReadOnlyViolation?: boolean;
}

export class DestructiveQueryGuard {
  /**
   * Returns true if the connection profile is flagged as protected/production.
   */
  public static isProduction(config: ConnectionConfig): boolean {
    if (config.safeMode) return true;
    if (config.color === 'red') return true;
    if (config.group && /\b(prod|production)\b/i.test(config.group)) return true;
    return false;
  }

  /**
   * Inspects a SQL query string and detects destructive or read-only violations.
   */
  public static checkQuery(sql: string, config?: ConnectionConfig): DestructiveCheckResult {
    const cleanSql = sql
      .replace(/--.*$/gm, '') // remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // remove block comments
      .trim();

    if (!cleanSql) {
      return { isDestructive: false };
    }

    const isReadOnly = !!config?.readOnly;
    const isProd = config ? DestructiveQueryGuard.isProduction(config) : false;

    // Check read-only violation
    if (isReadOnly) {
      const writeRegex = /^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+DATABASE)\b/i;
      if (writeRegex.test(cleanSql)) {
        return {
          isDestructive: true,
          isReadOnlyViolation: true,
          reason: t('Write operations are forbidden on Read-Only connections.', 'Операции записи запрещены на подключениях только для чтения.'),
        };
      }
    }

    // 1. DROP operations
    if (/\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW)\b/i.test(cleanSql)) {
      return {
        isDestructive: true,
        reason: t('Detected DROP operation.', 'Обнаружена операция DROP.'),
      };
    }

    // 2. TRUNCATE operations
    if (/\bTRUNCATE\s+(TABLE\s+)?/i.test(cleanSql)) {
      return {
        isDestructive: true,
        reason: t('Detected TRUNCATE operation.', 'Обнаружена операция TRUNCATE.'),
      };
    }

    // 3. DELETE without WHERE clause
    if (/\bDELETE\s+FROM\s+[a-zA-Z0-9_."`]+/i.test(cleanSql)) {
      if (!/\bWHERE\b/i.test(cleanSql)) {
        return {
          isDestructive: true,
          reason: t('Detected DELETE statement without a WHERE clause (will delete ALL rows).', 'Обнаружен DELETE без условия WHERE (удалит ВСЕ строки).'),
        };
      }
    }

    // 4. UPDATE without WHERE clause
    if (/\bUPDATE\s+[a-zA-Z0-9_."`]+\s+SET\b/i.test(cleanSql)) {
      if (!/\bWHERE\b/i.test(cleanSql)) {
        return {
          isDestructive: true,
          reason: t('Detected UPDATE statement without a WHERE clause (will modify ALL rows).', 'Обнаружен UPDATE без условия WHERE (изменит ВСЕ строки).'),
        };
      }
    }

    // 5. ALTER TABLE DROP COLUMN
    if (/\bALTER\s+TABLE\s+.*?\bDROP\s+COLUMN\b/i.test(cleanSql)) {
      return {
        isDestructive: true,
        reason: t('Detected ALTER TABLE DROP COLUMN operation.', 'Обнаружено удаление колонки (ALTER TABLE DROP COLUMN).'),
      };
    }

    return { isDestructive: false };
  }
}
