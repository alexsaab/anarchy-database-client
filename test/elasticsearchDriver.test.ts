import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElasticsearchDriver } from '../src/drivers/ElasticsearchDriver.js';

test('ElasticsearchDriver parses v7 wrapped responses ({ body: { hits: ... } })', async () => {
  const driver = new ElasticsearchDriver({
    id: 'es1',
    name: 'Elasticsearch Test',
    type: 'Elasticsearch',
    host: '127.0.0.1',
    port: 9200,
  } as any);

  (driver as any).client = {
    search: async (opts: any) => {
      return {
        body: {
          took: 3,
          hits: {
            total: { value: 2, relation: 'eq' },
            hits: [
              {
                _id: 'doc-1',
                _score: 1.5,
                _source: { title: 'First document', count: 42 },
              },
              {
                _id: 'doc-2',
                _score: 0.8,
                _source: { title: 'Second document', extra: 'hello' },
              },
            ],
          },
        },
        statusCode: 200,
      };
    },
    indices: {
      getMapping: async () => ({
        body: {
          alexsaab_search: {
            mappings: {
              properties: {
                title: { type: 'text' },
                count: { type: 'integer' },
                extra: { type: 'keyword' },
              },
            },
          },
        },
      }),
    },
  };
  (driver as any).isConnected = true;

  const result = await driver.getTableData('alexsaab_search', { page: 1, pageSize: 50 });
  assert.equal(result.totalCount, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]._id, 'doc-1');
  assert.equal(result.rows[0].title, 'First document');
  assert.equal(result.rows[0].count, 42);
  assert.equal(result.rows[1].extra, 'hello');

  // Verify fields contain _id with isPrimaryKey: true, plus discovered fields
  const idField = result.fields.find((f) => f.name === '_id');
  assert.ok(idField, '_id column must exist');
  assert.equal(idField.isPrimaryKey, true, '_id must be marked as primary key');
  assert.ok(result.fields.some((f) => f.name === 'title'), 'title field must exist');
  assert.ok(result.fields.some((f) => f.name === 'extra'), 'extra field must exist');
});

test('ElasticsearchDriver parses v8 direct responses ({ hits: ... })', async () => {
  const driver = new ElasticsearchDriver({
    id: 'es2',
    name: 'Elasticsearch v8 Test',
    type: 'Elasticsearch',
    host: '127.0.0.1',
    port: 9200,
  } as any);

  (driver as any).client = {
    search: async (opts: any) => {
      return {
        took: 2,
        hits: {
          total: 1,
          hits: [
            {
              _id: 'v8-doc',
              _score: 1.0,
              _source: { query: 'test data', active: true },
            },
          ],
        },
      };
    },
    indices: {
      getMapping: async () => ({
        test_index: {
          mappings: {
            properties: {
              query: { type: 'text' },
              active: { type: 'boolean' },
            },
          },
        },
      }),
    },
  };
  (driver as any).isConnected = true;

  const result = await driver.getTableData('test_index', { page: 1, pageSize: 10 });
  assert.equal(result.totalCount, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]._id, 'v8-doc');
  assert.equal(result.rows[0].query, 'test data');
  assert.equal(result.rows[0].active, true);
});

test('ElasticsearchDriver getColumns returns _id and mapping fields', async () => {
  const driver = new ElasticsearchDriver({
    id: 'es3',
    name: 'Elasticsearch Mapping Test',
    type: 'Elasticsearch',
    host: '127.0.0.1',
    port: 9200,
  } as any);

  (driver as any).client = {
    indices: {
      getMapping: async () => ({
        alexsaab_search: {
          mappings: {
            properties: {
              field1: { type: 'keyword' },
              field2: { type: 'long' },
            },
          },
        },
      }),
    },
  };
  (driver as any).isConnected = true;

  const cols = await driver.getColumns('alexsaab_search');
  assert.ok(cols.some((c) => c.name === '_id' && c.isPrimaryKey));
  assert.ok(cols.some((c) => c.name === '_score'));
  assert.ok(cols.some((c) => c.name === 'field1'));
  assert.ok(cols.some((c) => c.name === 'field2'));
});
