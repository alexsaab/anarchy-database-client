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

function emittedScripts(tsSource: string): string[] {
  return [...tsSource.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) =>
    m[1]
      // Emulate template-literal unescaping, then blank out ${...} holes.
      .replace(/\\'/g, "'")
      .replace(/\\`/g, '`')
      .replace(/\$\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '"__EXPR__"')
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
