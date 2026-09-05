import { test } from 'node:test';
import assert from 'node:assert/strict';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vscodeStub = require('./stubs/vscode.js');
import {
  clearRememberedParameters,
  resolveQueryParameters,
} from '../src/sql/QueryParameterPrompt.js';

const recorded = vscodeStub.__recorded;

function reset(answers: (string | null)[] = [], configuration: Record<string, unknown> = {}) {
  recorded.inputBoxAnswers = [...answers];
  recorded.inputBoxOptions = [];
  recorded.configuration = configuration;
  clearRememberedParameters();
}

test('a statement without placeholders is returned untouched and prompts nothing', async () => {
  reset();
  const sql = 'SELECT * FROM users';
  assert.equal(await resolveQueryParameters(sql), sql);
  assert.equal(recorded.inputBoxOptions.length, 0);
});

test('collected values are substituted into the statement', async () => {
  reset(['Alice', '18']);
  const out = await resolveQueryParameters('SELECT * FROM users WHERE name = :name AND age > :age');
  assert.equal(out, "SELECT * FROM users WHERE name = 'Alice' AND age > 18");
  assert.equal(recorded.inputBoxOptions.length, 2);
});

test('dismissing a prompt cancels the whole execution', async () => {
  reset(['Alice', null]);
  assert.equal(await resolveQueryParameters('SELECT :a, :b FROM t'), undefined);
});

test('earlier answers come back as defaults on the next run', async () => {
  reset(['Alice']);
  await resolveQueryParameters('SELECT * FROM users WHERE name = :name');
  recorded.inputBoxAnswers = ['Bob'];
  recorded.inputBoxOptions = [];
  await resolveQueryParameters('SELECT * FROM users WHERE name = :name');
  assert.equal(recorded.inputBoxOptions[0].value, 'Alice');
});

test('turning the setting off runs the statement as typed', async () => {
  reset(['Alice'], { 'anarchyDbClient.promptForQueryParameters': false });
  const sql = 'SELECT * FROM users WHERE name = :name';
  assert.equal(await resolveQueryParameters(sql), sql);
  assert.equal(recorded.inputBoxOptions.length, 0);
});

test('each ? is prompted separately and labelled by position', async () => {
  reset(['1', 'two']);
  const out = await resolveQueryParameters('SELECT * FROM t WHERE a = ? AND b = ?');
  assert.equal(out, "SELECT * FROM t WHERE a = 1 AND b = 'two'");
  assert.match(recorded.inputBoxOptions[0].prompt, /\? #1/);
  assert.match(recorded.inputBoxOptions[1].prompt, /\? #2/);
});
