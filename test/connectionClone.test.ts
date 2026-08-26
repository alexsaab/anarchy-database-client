import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStorageService } from '../src/storage/ConnectionStorage.js';
import { ConnectionConfig } from '../src/model/ConnectionConfig.js';

function createMockContext() {
  const globalStore = new Map<string, any>();
  const secretStore = new Map<string, string>();

  const context: any = {
    globalState: {
      get: (key: string, defaultValue?: any) => {
        return globalStore.has(key) ? globalStore.get(key) : defaultValue;
      },
      update: async (key: string, value: any) => {
        globalStore.set(key, value);
      },
    },
    secrets: {
      get: async (key: string) => secretStore.get(key),
      store: async (key: string, value: string) => {
        secretStore.set(key, value);
      },
      delete: async (key: string) => {
        secretStore.delete(key);
      },
    },
  };

  return { context, globalStore, secretStore };
}

test('cloneConnection duplicates properties and creates unique ID', async () => {
  const { context } = createMockContext();
  const storage = new ConnectionStorageService(context);

  const initialConfig: ConnectionConfig = {
    id: 'conn_orig',
    name: 'Production DB',
    type: 'PostgreSQL',
    host: '10.0.0.1',
    port: 5432,
    user: 'admin',
    database: 'analytics',
    schema: 'public',
    group: 'Servers',
    color: 'red',
    ssl: true,
    ssh: {
      enabled: true,
      host: 'ssh.server.com',
      port: 2222,
      username: 'sshuser',
      usePrivateKey: true,
      privateKeyPath: '/home/user/.ssh/id_rsa',
    },
  };

  await storage.saveConnection(initialConfig, 'supersecret', 'sshsecret');

  const cloned = await storage.cloneConnection('conn_orig');
  assert.ok(cloned, 'Cloned profile should not be undefined');
  assert.notEqual(cloned.id, 'conn_orig');
  assert.equal(cloned.name, 'Production DB (Copy)');
  assert.equal(cloned.type, 'PostgreSQL');
  assert.equal(cloned.host, '10.0.0.1');
  assert.equal(cloned.port, 5432);
  assert.equal(cloned.user, 'admin');
  assert.equal(cloned.database, 'analytics');
  assert.equal(cloned.schema, 'public');
  assert.equal(cloned.group, 'Servers');
  assert.equal(cloned.color, 'red');
  assert.equal(cloned.ssl, true);
  assert.deepEqual(cloned.ssh, initialConfig.ssh);

  // Check passwords were copied into secrets
  const pass = await storage.getPassword(cloned.id);
  assert.equal(pass, 'supersecret');
  const sshPass = await storage.getSshPassword(cloned.id);
  assert.equal(sshPass, 'sshsecret');

  // Both connections should be present in getConnections
  const all = storage.getConnections();
  assert.equal(all.length, 2);
  assert.equal(all[0].id, 'conn_orig');
  assert.equal(all[1].id, cloned.id);
});

test('cloneConnection increments copy number when multiple copies exist', async () => {
  const { context } = createMockContext();
  const storage = new ConnectionStorageService(context);

  const initialConfig: ConnectionConfig = {
    id: 'conn_1',
    name: 'MySQL Dev',
    type: 'MySQL',
    host: 'localhost',
    port: 3306,
  };

  await storage.saveConnection(initialConfig);

  const clone1 = await storage.cloneConnection('conn_1');
  assert.equal(clone1?.name, 'MySQL Dev (Copy)');

  const clone2 = await storage.cloneConnection('conn_1');
  assert.equal(clone2?.name, 'MySQL Dev (Copy 2)');

  const clone3 = await storage.cloneConnection('conn_1');
  assert.equal(clone3?.name, 'MySQL Dev (Copy 3)');
});

test('cloneConnection supports custom naming', async () => {
  const { context } = createMockContext();
  const storage = new ConnectionStorageService(context);

  const initialConfig: ConnectionConfig = {
    id: 'conn_sqlite',
    name: 'Local SQLite',
    type: 'SQLite',
    dbPath: '/path/to/test.db',
  };

  await storage.saveConnection(initialConfig);

  const clone = await storage.cloneConnection('conn_sqlite', 'Local SQLite Backup');
  assert.equal(clone?.name, 'Local SQLite Backup');
  assert.equal(clone?.dbPath, '/path/to/test.db');
});

test('cloneConnection returns undefined if source id is invalid', async () => {
  const { context } = createMockContext();
  const storage = new ConnectionStorageService(context);

  const clone = await storage.cloneConnection('non_existent_id');
  assert.equal(clone, undefined);
});
