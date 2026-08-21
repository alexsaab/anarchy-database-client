import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionState } from '../src/drivers/ConnectionState.js';
import { BaseDriver } from '../src/drivers/BaseDriver.js';

test('classifies a nulled driver handle as a lost connection', () => {
  assert.ok(ConnectionState.isConnectionError(new TypeError("Cannot read properties of null (reading 'query')")));
  assert.ok(ConnectionState.isConnectionError(new TypeError("Cannot read property 'query' of undefined")));
});

test('classifies transport failures as lost connections', () => {
  for (const e of [
    Object.assign(new Error('x'), { code: 'ECONNRESET' }),
    Object.assign(new Error('x'), { code: 'PROTOCOL_CONNECTION_LOST' }),
    Object.assign(new Error('x'), { fatal: true }),
    new Error('Connection terminated unexpectedly'),
    new Error('Client has encountered a connection error and is not queryable'),
    new Error('terminating connection due to administrator command'),
  ]) {
    assert.ok(ConnectionState.isConnectionError(e), `should be a connection error: ${e.message}/${(e as any).code}`);
  }
});

test('does not misclassify ordinary SQL errors', () => {
  for (const e of [
    new Error('syntax error at or near "slect"'),
    new Error('relation "nope" does not exist'),
    new Error('Duplicate entry \'1\' for key \'PRIMARY\''),
    new Error('permission denied for table users'),
  ]) {
    assert.equal(ConnectionState.isConnectionError(e), false, `should not be a connection error: ${e.message}`);
  }
});

// A driver whose socket dies mid-query, the way pg and mysql2 do.
class FlakyDriver extends BaseDriver {
  public handle: { query(): Promise<any> } | null = null;
  public handshakes = 0;
  public failNext = false;

  async connect(): Promise<void> {
    if (this.isConnected && this.handle) return;
    await this.connectOnce(async () => {
      if (this.isConnected && this.handle) return;
      this.handshakes++;
      await new Promise((r) => setTimeout(r, 5));
      const self = this;
      this.handle = {
        async query() {
          if (self.failNext) {
            self.failNext = false;
            self.handle = null;          // socket error handler retires it
            self.isConnected = false;
            throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
          }
          return { rows: [{ ok: 1 }] };
        },
      };
      this.isConnected = true;
    });
  }
  async disconnect(): Promise<void> { this.handle = null; this.isConnected = false; }
  async testConnection() { return { success: true }; }
  async getDatabases() { return []; }
  async getTables() { return []; }
  async getColumns() { return []; }
  async getTableData(): Promise<any> { return this.executeQuery(''); }
  async executeQuery(): Promise<any> {
    return this.withReconnect(async () => {
      await this.connect();
      const h = this.handle;
      if (!h) throw Object.assign(new Error('Connection to the database was lost.'), { code: 'CONNECTION_CLOSED' });
      const r = await h.query();
      return { rows: r.rows, fields: [], costTimeMs: 0 };
    });
  }
}

const cfg = { id: 'unit', name: 'unit', type: 'PostgreSQL' } as any;

test('parallel connects share one handshake', async () => {
  const d = new FlakyDriver(cfg);
  await Promise.all(Array.from({ length: 8 }, () => d.connect()));
  assert.equal(d.handshakes, 1);
});

test('a query survives a mid-flight disconnect', async () => {
  const d = new FlakyDriver(cfg);
  d.failNext = true;
  const res: any = await d.executeQuery();
  assert.deepEqual(res.rows, [{ ok: 1 }]);
});

test('parallel queries all survive an outage', async () => {
  const d = new FlakyDriver(cfg);
  d.failNext = true;
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => d.executeQuery()));
  assert.equal(results.filter((r) => r.status === 'rejected').length, 0);
});

test('state transitions are reported', async () => {
  const seen: string[] = [];
  ConnectionState.getInstance().onDidChange((c) => { if (c.connectionId === 'evt') seen.push(c.info.status); });
  const d = new FlakyDriver({ ...cfg, id: 'evt' } as any);
  d.failNext = true;
  await d.executeQuery();
  assert.ok(seen.includes('lost'), `expected a lost state, saw ${seen}`);
  assert.equal(seen[seen.length - 1], 'connected');
});
