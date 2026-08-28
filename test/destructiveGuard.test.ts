import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DestructiveQueryGuard } from '../src/sql/DestructiveQueryGuard.js';
import { ConnectionConfig } from '../src/model/ConnectionConfig.js';

const prodConfig: ConnectionConfig = {
  id: 'prod-1',
  name: 'Production PostgreSQL',
  type: 'PostgreSQL',
  color: 'red',
  group: 'Production',
};

const devConfig: ConnectionConfig = {
  id: 'dev-1',
  name: 'Local Dev SQLite',
  type: 'SQLite',
  color: 'blue',
  group: 'Local',
};

const readOnlyConfig: ConnectionConfig = {
  id: 'ro-1',
  name: 'Analytics Replica',
  type: 'PostgreSQL',
  readOnly: true,
};

test('DestructiveQueryGuard identifies production connections by color or group', () => {
  assert.equal(DestructiveQueryGuard.isProduction(prodConfig), true);
  assert.equal(DestructiveQueryGuard.isProduction(devConfig), false);
  assert.equal(DestructiveQueryGuard.isProduction({ ...devConfig, safeMode: true }), true);
});

test('DestructiveQueryGuard flags DROP operations as destructive', () => {
  const q1 = DestructiveQueryGuard.checkQuery('DROP TABLE users;', devConfig);
  assert.equal(q1.isDestructive, true);
  assert.match(q1.reason || '', /DROP/i);

  const q2 = DestructiveQueryGuard.checkQuery('DROP DATABASE production_db;', devConfig);
  assert.equal(q2.isDestructive, true);
});

test('DestructiveQueryGuard flags TRUNCATE operations as destructive', () => {
  const q = DestructiveQueryGuard.checkQuery('TRUNCATE TABLE logs;', devConfig);
  assert.equal(q.isDestructive, true);
  assert.match(q.reason || '', /TRUNCATE/i);
});

test('DestructiveQueryGuard flags DELETE without WHERE as destructive', () => {
  const unconstrained = DestructiveQueryGuard.checkQuery('DELETE FROM users;', devConfig);
  assert.equal(unconstrained.isDestructive, true);
  assert.match(unconstrained.reason || '', /without a WHERE/i);

  const safe = DestructiveQueryGuard.checkQuery('DELETE FROM users WHERE id = 5;', devConfig);
  assert.equal(safe.isDestructive, false);
});

test('DestructiveQueryGuard flags UPDATE without WHERE as destructive', () => {
  const unconstrained = DestructiveQueryGuard.checkQuery('UPDATE users SET status = "inactive";', devConfig);
  assert.equal(unconstrained.isDestructive, true);
  assert.match(unconstrained.reason || '', /without a WHERE/i);

  const safe = DestructiveQueryGuard.checkQuery('UPDATE users SET status = "inactive" WHERE id = 10;', devConfig);
  assert.equal(safe.isDestructive, false);
});

test('DestructiveQueryGuard blocks write operations on Read-Only connections', () => {
  const writeRes = DestructiveQueryGuard.checkQuery('INSERT INTO audit_log (msg) VALUES ("test");', readOnlyConfig);
  assert.equal(writeRes.isDestructive, true);
  assert.equal(writeRes.isReadOnlyViolation, true);

  const selectRes = DestructiveQueryGuard.checkQuery('SELECT * FROM users WHERE active = true;', readOnlyConfig);
  assert.equal(selectRes.isDestructive, false);
});
