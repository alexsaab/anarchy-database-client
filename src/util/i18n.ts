import * as vscode from 'vscode';

export type SupportedLang = 'en' | 'ru' | 'de' | 'zh';

export function getLanguage(): SupportedLang {
  const lang = vscode.env.language.toLowerCase();
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('de')) return 'de';
  if (lang.startsWith('zh')) return 'zh';
  return 'en';
}

export function isRussian(): boolean {
  return getLanguage() === 'ru';
}

export function t(
  en: string,
  ru?: string,
  de?: string,
  zh?: string
): string {
  const lang = getLanguage();
  if (lang === 'ru' && ru) return ru;
  if (lang === 'de' && de) return de;
  if (lang === 'zh' && zh) return zh;
  if (lang !== 'en' && ru) return ru; // fallback to ru if specified
  return en;
}
