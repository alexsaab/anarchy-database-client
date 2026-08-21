import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHost } from '../src/util/HostUtil.js';

const url = (raw: any, o: any) => parseHost(raw, o).url;

test('accepts a bare host', () => assert.equal(url('185.78.29.22', { defaultPort: 9200 }), 'http://185.78.29.22:9200'));
test('accepts host:port', () => assert.equal(url('example.com:9300', { defaultPort: 9200 }), 'http://example.com:9300'));
test('accepts a pasted URL', () => assert.equal(url('http://10.0.0.1:9200', { defaultPort: 9200, configPort: 9200 }), 'http://10.0.0.1:9200'));
test('tolerates a duplicated port', () => assert.equal(url('http://10.0.0.1:9200:9200', { defaultPort: 9200 }), 'http://10.0.0.1:9200'));
test('a scheme in the host overrides the ssl flag', () => {
  assert.equal(url('http://10.0.0.1', { defaultPort: 9200, ssl: true }), 'http://10.0.0.1:9200');
  assert.equal(url('10.0.0.1', { defaultPort: 9200, ssl: true }), 'https://10.0.0.1:9200');
});
test('strips embedded credentials', () => assert.equal(url('http://user:pw@10.0.0.1:9200', { defaultPort: 9200 }), 'http://10.0.0.1:9200'));
test('keeps a base path for proxied endpoints', () => {
  const p = parseHost('http://proxy.local/es/', { defaultPort: 9200 });
  assert.equal(p.basePath, '/es');
  assert.equal(p.url, 'http://proxy.local:9200/es');
});
test('handles ipv6', () => assert.equal(url('[::1]:9200', { defaultPort: 9200 }), 'http://[::1]:9200'));
test('falls back to the configured port then the default', () => {
  assert.equal(url('  10.0.0.1  ', { defaultPort: 9200, configPort: 9201 }), 'http://10.0.0.1:9201');
  assert.equal(url(undefined, { defaultPort: 8123 }), 'http://localhost:8123');
  assert.equal(url('', { defaultPort: 5984 }), 'http://localhost:5984');
});
