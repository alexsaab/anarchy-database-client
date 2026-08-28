import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

/**
 * Every webview page is assembled as a TypeScript template literal, so an
 * escape written for the generated JS (\' or \`) collapses at build time and
 * turns the whole <script> into a syntax error. TypeScript and esbuild both
 * accept that happily; only the browser rejects it, silently, at runtime.
 * This test parses the emitted script of every webview page.
 */
const webviewDir = path.join(__dirname, '..', 'src', 'webview');

/**
 * The webview <script> is written inside a TypeScript template literal, so the
 * compiler resolves every backslash escape once at build time. To parse the
 * script as the browser will see it we must apply that same unescaping here.
 * This is a single left-to-right pass, so `\\n` becomes a literal `\n` (two
 * characters) while a bare `\n` becomes a newline -- the exact split that broke
 * generated JS when a string literal like 'a\nb' was written without doubling
 * the backslash.
 */
const ESCAPE = /\\(?:[nrtbfv0]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]+\}|['"`\\$]|\n)/g;

function unescapeTemplate(script: string): string {
  return script.replace(ESCAPE, (m) => {
    switch (m) {
      case '\\n': return '\n';
      case '\\r': return '\r';
      case '\\t': return '\t';
      case '\\b': return '\b';
      case '\\f': return '\f';
      case '\\v': return '\v';
      case '\\0': return '\0';
      case '\\\\': return '\\';
      case "\\'": return "'";
      case '\\"': return '"';
      case '\\`': return '`';
      case '\\$': return '$';
      default:
        if (m.startsWith('\\x')) return String.fromCharCode(parseInt(m.slice(2), 16));
        if (m.startsWith('\\u{')) return String.fromCodePoint(parseInt(m.slice(3, -1), 16));
        if (m.startsWith('\\u')) return String.fromCharCode(parseInt(m.slice(2), 16));
        return m;
    }
  });
}

function emittedScripts(tsSource: string): string[] {
  return [...tsSource.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) =>
    // Blank out ${...} interpolation holes first, then resolve escapes.
    unescapeTemplate(m[1].replace(/\$\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '"__EXPR__"'))
  );
}

const files = fs.readdirSync(webviewDir).filter((f) => f.endsWith('.ts'));

test('there are webview files to check', () => assert.ok(files.length > 0));

for (const file of files) {
  const source = fs.readFileSync(path.join(webviewDir, file), 'utf8');
  const scripts = emittedScripts(source);
  scripts.forEach((script, i) => {
    test(`${file} script #${i + 1} parses as JavaScript`, () => {
      assert.doesNotThrow(() => new vm.Script(script), (err: any) => {
        return new Error(`generated script is not valid JS: ${err.message}`);
      });
    });
  });
}

test('no webview writes a raw escaped quote into generated JS', () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(webviewDir, file), 'utf8');
    // \' inside the template collapses to a bare quote and breaks the script.
    // Written as \\' it survives, which is what the emitted JS needs.
    const offenders = source
      .split('\n')
      .map((line, n) => ({ line, n: n + 1 }))
      .filter(({ line }) => /[^\\]\\'/.test(line) && !line.includes("replace(/'"));
    assert.deepEqual(offenders, [], `${file}: use \\\\' so the emitted JS keeps its escape`);
  }
});
