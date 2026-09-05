import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiService } from '../src/ai/AiService.js';

const mockSchema = `
Table customers: (id int, name varchar, email varchar, created_at timestamp)
Table orders: (id int, customer_id int, amount decimal, order_date timestamp)
Table products: (id int, title varchar, price decimal, in_stock int)
`;

test('AiService generates count query based on natural language prompt', async () => {
  const res = await AiService.generateSql('Сколько всего клиентов в базе?', mockSchema, 'PostgreSQL');
  assert.ok(res.sql);
  assert.match(res.sql, /COUNT\(\*\)/i);
  assert.match(res.sql, /customers/i);
});

test('AiService generates recent/top query based on natural language prompt', async () => {
  const res = await AiService.generateSql('Покажи последние заказы', mockSchema, 'PostgreSQL');
  assert.ok(res.sql);
  assert.match(res.sql, /orders/i);
  assert.match(res.sql, /ORDER BY/i);
  assert.match(res.sql, /LIMIT 20/i);
});

test('AiService generates sum aggregation query', async () => {
  const res = await AiService.generateSql('Какая общая сумма заказов?', mockSchema, 'PostgreSQL');
  assert.ok(res.sql);
  assert.match(res.sql, /SUM\(amount\)/i);
  assert.match(res.sql, /orders/i);
});

test('AiService explains SQL queries in human terms', () => {
  const explanation = AiService.explainQuery('SELECT * FROM customers WHERE id > 100 JOIN orders ON orders.customer_id = customers.id;');
  assert.ok(explanation.length > 0);
  assert.match(explanation, /customers/i);
});

test('AiService detects the provider from the key prefix', () => {
  assert.equal(AiService.detectProvider('sk-ant-api03-xxx'), 'anthropic');
  assert.equal(AiService.detectProvider('sk-proj-xxx'), 'openai');
  // Self-hosted OpenAI-compatible gateways use arbitrary tokens.
  assert.equal(AiService.detectProvider('local-token'), 'openai');
});

test('AiService parses a strict JSON model response', () => {
  const parsed = AiService.parseSqlResponse('{"sql":"SELECT 1;","explanation":"Trivial."}');
  assert.equal(parsed?.sql, 'SELECT 1;');
  assert.equal(parsed?.explanation, 'Trivial.');
});

test('AiService parses JSON wrapped in a markdown fence', () => {
  const parsed = AiService.parseSqlResponse('```json\n{"sql":"SELECT 2;"}\n```');
  assert.equal(parsed?.sql, 'SELECT 2;');
});

test('AiService falls back to a fenced sql block, then to plain text', () => {
  assert.equal(AiService.parseSqlResponse('Here you go:\n```sql\nSELECT 3;\n```')?.sql, 'SELECT 3;');
  assert.equal(AiService.parseSqlResponse('SELECT 4;')?.sql, 'SELECT 4;');
});

test('AiService returns null for an empty model response', () => {
  assert.equal(AiService.parseSqlResponse(''), null);
  assert.equal(AiService.parseSqlResponse('   '), null);
});

test('AiService prompt carries the dialect, schema and request', () => {
  const prompt = AiService.buildPrompt('all users', 'Table users: (id int)', 'MySQL');
  assert.match(prompt, /MySQL/);
  assert.match(prompt, /Table users: \(id int\)/);
  assert.match(prompt, /all users/);
});

test('AiService falls back to the heuristic engine when the key is rejected', async () => {
  // An unroutable key means every cloud call fails; generateSql must still answer.
  const res = await AiService.generateSql('сколько пользователей', mockSchema, 'PostgreSQL', '');
  assert.match(res.sql, /COUNT\(\*\)/i);
});
