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
