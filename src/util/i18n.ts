import * as vscode from 'vscode';

export function isRussian(): boolean {
  return vscode.env.language.startsWith('ru');
}

export function t(en: string, ru: string): string {
  return isRussian() ? ru : en;
}
