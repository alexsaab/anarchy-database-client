import { BaseDriver } from './BaseDriver.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { AliasInfo, ColumnInfo, PageParams, QueryResult, TableInfo } from '../model/QueryTypes.js';
import { parseHost } from '../util/HostUtil.js';

export class ElasticsearchDriver extends BaseDriver {
  private client: any = null;

  constructor(config: ConnectionConfig, password?: string) {
    super(config, password);
  }

  /** The endpoint this driver talks to, after normalising whatever was typed. */
  public get nodeUrl(): string {
    return parseHost(this.config.host, {
      defaultPort: 9200,
      configPort: this.config.port,
      ssl: this.config.ssl,
    }).url;
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    await this.connectOnce(async () => {
      if (this.isConnected && this.client) {
        return;
      }
      await this.disconnect().catch(() => {});

      const node = this.nodeUrl;

      let ClientClass: any;
      try {
        const elasticModule = require('@elastic/elasticsearch');
        ClientClass = elasticModule.Client;
      } catch (e) {
        throw new Error('The "@elastic/elasticsearch" module is not installed. Run: npm install @elastic/elasticsearch');
      }

      // Basic auth: the client sets the Authorization header itself from `auth`,
      // so it must not also be passed in `headers` (duplicates get rejected).
      const auth =
        this.config.user && this.password
          ? { username: this.config.user, password: this.password }
          : undefined;

      const client = new ClientClass({
        node,
        auth,
        requestTimeout: 15000,
        tls: node.startsWith('https') ? { rejectUnauthorized: false } : undefined,
      });

      // Verify now rather than letting the first query fail with a confusing
      // error somewhere else.
      try {
        await client.info();
      } catch (err: any) {
        try {
          await client.close();
        } catch (e) {}
        throw ElasticsearchDriver.describeError(err, node, this.config.user);
      }

      this.client = client;
      this.isConnected = true;
    });
  }

  /** Turns raw transport/HTTP failures into something actionable. */
  private static describeError(err: any, node: string, user?: string): Error {
    const status = err?.meta?.statusCode ?? err?.statusCode;
    const code = String(err?.code || err?.cause?.code || '');
    const raw = String(err?.message || err);

    if (status === 401) {
      return new Error(
        `Authentication failed for ${node}${user ? ` as "${user}"` : ''}. Check the username and password.`
      );
    }
    if (status === 403) {
      return new Error(`User${user ? ` "${user}"` : ''} is not authorized on ${node} (HTTP 403).`);
    }
    if (code === 'ECONNREFUSED') {
      return new Error(`Connection refused by ${node}. Is Elasticsearch listening on that host and port?`);
    }
    if (code === 'EAI_AGAIN' || code === 'ENOTFOUND' || /\b(EAI_AGAIN|ENOTFOUND|getaddrinfo)\b/.test(raw)) {
      return new Error(`The host in ${node} could not be resolved. Check the Host field.`);
    }
    if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(raw)) {
      return new Error(`Connection refused by ${node}. Is Elasticsearch listening on that host and port?`);
    }
    if (/other side closed|socket hang up/i.test(raw)) {
      return new Error(
        `${node} accepted the socket then closed it. Check that the port really is Elasticsearch, and whether it needs HTTPS.`
      );
    }
    if (code === 'ETIMEDOUT' || /timeout/i.test(raw)) {
      return new Error(`Timed out connecting to ${node}. Check the port and any firewall in between.`);
    }
    if (/packet length too long|wrong version number|SSL routines/i.test(raw)) {
      return new Error(
        `TLS handshake failed against ${node}. That endpoint looks like plain HTTP — turn the SSL option off.`
      );
    }
    if (/socket hang up|ECONNRESET/i.test(raw) && node.startsWith('http://')) {
      return new Error(
        `${node} closed the connection. If the server requires HTTPS, turn the SSL option on.`
      );
    }
    return new Error(`Could not connect to ${node}: ${raw}`);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (e) {}
      this.client = null;
      this.isConnected = false;
    }
  }

  async testConnection(): Promise<{ success: boolean; message?: string }> {
    try {
      await this.connect();
      const info = await this.client.info();
      const version = info?.version?.number || info?.body?.version?.number;
      const cluster = info?.cluster_name || info?.body?.cluster_name;
      await this.disconnect();
      return {
        success: true,
        message: `Connected to Elasticsearch ${version || ''} at ${this.nodeUrl}${cluster ? ` (cluster "${cluster}")` : ''}.`,
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  /** Not a SQL store: the grid must not generate INSERT/UPDATE/DELETE for it. */
  public get supportsSqlWrites(): boolean {
    return false;
  }

  async getDatabases(): Promise<string[]> {
    return ['cluster'];
  }

  private static unwrap(res: any): any {
    // The v7 client wraps payloads in .body; v8 returns them directly.
    return res && typeof res === 'object' && 'body' in res && !Array.isArray(res) ? res.body : res;
  }

  async getTables(): Promise<TableInfo[]> {
    if (!this.client) {
      await this.connect();
    }
    const catIndices = ElasticsearchDriver.unwrap(await this.client.cat.indices({ format: 'json' }));
    const indices = Array.isArray(catIndices) ? catIndices : [];

    // One round trip for every alias in the cluster, mapped back onto its index.
    const aliasesByIndex = new Map<string, string[]>();
    try {
      const aliasRes = ElasticsearchDriver.unwrap(await this.client.indices.getAlias());
      for (const indexName of Object.keys(aliasRes || {})) {
        const names = Object.keys(aliasRes[indexName]?.aliases || {});
        if (names.length > 0) {
          aliasesByIndex.set(indexName, names.sort());
        }
      }
    } catch (e) {
      // Alias listing is a nicety; never let it hide the index list.
    }

    return indices
      .filter((idx: any) => !String(idx.index).startsWith('.'))
      .map((idx: any) => ({
        name: idx.index,
        type: 'table',
        aliases: aliasesByIndex.get(idx.index),
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  /**
   * Quick-search query. Every token must match (the default is OR, which makes
   * a nonsense term match anything sharing one word) and each gets a trailing
   * wildcard so partial values behave like the SQL grid's LIKE search.
   */
  private static searchQuery(term: string): any {
    const escape = (token: string) => token.replace(/([+\-=&|><!(){}\[\]^"~*?:\\/])/g, '\\$1');
    const query = String(term)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => `${escape(token)}*`)
      .join(' ');

    return { simple_query_string: { query, default_operator: 'AND', lenient: true } };
  }

  /** Every alias in the cluster, with the indices it resolves to. */
  async getAliases(): Promise<AliasInfo[]> {
    if (!this.client) {
      await this.connect();
    }

    const res = ElasticsearchDriver.unwrap(await this.client.indices.getAlias());
    const byAlias = new Map<string, AliasInfo>();

    for (const indexName of Object.keys(res || {})) {
      if (indexName.startsWith('.')) {
        continue;
      }
      const aliases = res[indexName]?.aliases || {};
      for (const aliasName of Object.keys(aliases)) {
        if (aliasName.startsWith('.')) {
          continue;
        }
        const entry = byAlias.get(aliasName) || { name: aliasName, indices: [] };
        entry.indices.push(indexName);
        const meta = aliases[aliasName] || {};
        if (meta.is_write_index) {
          entry.writeIndex = indexName;
        }
        if (meta.filter) {
          entry.filtered = true;
        }
        byAlias.set(aliasName, entry);
      }
    }

    return Array.from(byAlias.values())
      .map((a) => ({ ...a, indices: a.indices.sort((x, y) => x.localeCompare(y, undefined, { numeric: true })) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  async getColumns(indexName: string): Promise<ColumnInfo[]> {
    if (!this.client) {
      await this.connect();
    }
    try {
      const mapping = ElasticsearchDriver.unwrap(await this.client.indices.getMapping({ index: indexName }));
      const key = mapping && mapping[indexName] ? indexName : Object.keys(mapping || {})[0];
      const properties = (mapping as any)?.[key]?.mappings?.properties || {};
      return Object.keys(properties).map((prop) => ({
        name: prop,
        type: properties[prop].type || 'object',
        nullable: true,
        isPrimaryKey: prop === '_id',
      }));
    } catch (e) {
      return [{ name: '_id', type: 'keyword', nullable: false, isPrimaryKey: true }];
    }
  }

  async executeQuery(queryJson: string): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const body = queryJson.trim() ? JSON.parse(queryJson) : { query: { match_all: {} } };

    const searchRes = await this.client.search({
      index: this.config.database || '_all',
      body,
    });
    const costTimeMs = Date.now() - startTime;

    const hits = searchRes.hits.hits.map((h: any) => ({
      _id: h._id,
      _index: h._index,
      ...h._source,
    }));

    const fields: ColumnInfo[] =
      hits.length > 0 ? Object.keys(hits[0]).map((k) => ({ name: k, type: 'unknown', nullable: true })) : [];

    return {
      rows: hits,
      fields,
      totalCount: typeof searchRes.hits.total === 'number' ? searchRes.hits.total : (searchRes.hits.total as any)?.value || 0,
      costTimeMs,
    };
  }

  async getTableData(indexName: string, params: PageParams): Promise<QueryResult> {
    if (!this.client) {
      await this.connect();
    }
    const startTime = Date.now();
    const from = (params.page - 1) * params.pageSize;

    // Free-text search maps onto Elasticsearch natively rather than through SQL.
    const query = params.searchTerm ? ElasticsearchDriver.searchQuery(params.searchTerm) : undefined;

    let searchRes: any;
    try {
      searchRes = await this.client.search({
        index: indexName,
        from,
        size: params.pageSize,
        ...(query ? { query } : {}),
        // Without this the count saturates at 10000 and the grid loses the tail pages.
        track_total_hits: true,
      });
    } catch (err: any) {
      const raw = String(err?.message || err);
      if (/Result window is too large|max_result_window/i.test(raw)) {
        const limit = (raw.match(/must be less than or equal to:? \[?(\d+)/) || [])[1];
        throw new Error(
          `Elasticsearch refuses to page this deep: row ${from + params.pageSize} is past this index's ` +
            `max_result_window${limit ? ` of ${limit}` : ''}. Narrow the result with a filter, or raise ` +
            `index.max_result_window on "${indexName}".`
        );
      }
      throw err;
    }
    const costTimeMs = Date.now() - startTime;

    const hits = searchRes.hits.hits.map((h: any) => ({
      _id: h._id,
      _score: h._score,
      ...h._source,
    }));

    const fields: ColumnInfo[] =
      hits.length > 0 ? Object.keys(hits[0]).map((k) => ({ name: k, type: typeof hits[0][k], nullable: true })) : [];

    const totalCount =
      typeof searchRes.hits.total === 'number' ? searchRes.hits.total : (searchRes.hits.total as any)?.value || 0;

    return {
      rows: hits,
      fields,
      totalCount,
      costTimeMs,
    };
  }
}
