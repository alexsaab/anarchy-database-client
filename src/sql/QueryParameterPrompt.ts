import * as vscode from 'vscode';
import { applyParameters, describeParameter, extractParameters } from './QueryParameters.js';
import { t } from '../util/i18n.js';

/**
 * Values entered earlier in the session, offered as defaults so re-running a
 * parameterised query is one Enter per placeholder instead of retyping.
 * Deliberately in-memory only: parameter values are frequently ids of real
 * records and have no business surviving a window reload.
 */
const rememberedValues = new Map<string, string>();

function isEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('anarchyDbClient')
    .get<boolean>('promptForQueryParameters', true);
}

/**
 * Asks for a value for every placeholder in the statement and returns the
 * statement with them substituted. Returns undefined when the user dismisses a
 * prompt, which callers must treat as "cancel the whole execution".
 */
export async function resolveQueryParameters(sql: string): Promise<string | undefined> {
  if (!isEnabled()) return sql;

  const params = extractParameters(sql);
  if (params.length === 0) return sql;

  const values = new Map<string, string>();
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    const uniqueKey = `${param.style}:${param.key}`;
    const label = describeParameter(param);

    const entered = await vscode.window.showInputBox({
      title: t(
        `Query parameter ${i + 1} of ${params.length}`,
        `Параметр запроса ${i + 1} из ${params.length}`
      ),
      prompt: t(`Value for ${label}`, `Значение для ${label}`),
      value: rememberedValues.get(uniqueKey) ?? '',
      ignoreFocusOut: true,
      placeHolder: t(
        'Numbers, true/false and NULL are inserted as-is; anything else is quoted',
        'Числа, true/false и NULL подставляются как есть; остальное — в кавычках'
      ),
    });

    if (entered === undefined) return undefined;
    values.set(uniqueKey, entered);
    rememberedValues.set(uniqueKey, entered);
  }

  return applyParameters(sql, values);
}

/** Test seam: drops the remembered defaults. */
export function clearRememberedParameters(): void {
  rememberedValues.clear();
}
