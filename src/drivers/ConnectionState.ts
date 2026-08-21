import * as vscode from 'vscode';

export type ConnectionStatus = 'idle' | 'connected' | 'lost';

export interface ConnectionStateInfo {
  status: ConnectionStatus;
  errorMessage?: string;
  since: number;
}

export interface ConnectionStateChange {
  connectionId: string;
  info: ConnectionStateInfo;
  previous: ConnectionStatus;
}

/**
 * Central, connection-id keyed record of live connection health.
 *
 * Tree nodes are rebuilt on every refresh, so per-node flags cannot survive to
 * describe the state of a connection. Drivers report here instead, and the tree,
 * the status bar and the data grid all read from this single source.
 */
export class ConnectionState {
  private static instance: ConnectionState;

  private states: Map<string, ConnectionStateInfo> = new Map();
  private emitter = new vscode.EventEmitter<ConnectionStateChange>();
  public readonly onDidChange = this.emitter.event;

  public static getInstance(): ConnectionState {
    if (!ConnectionState.instance) {
      ConnectionState.instance = new ConnectionState();
    }
    return ConnectionState.instance;
  }

  public get(connectionId: string): ConnectionStateInfo {
    return this.states.get(connectionId) || { status: 'idle', since: 0 };
  }

  public isLost(connectionId: string): boolean {
    return this.get(connectionId).status === 'lost';
  }

  public markConnected(connectionId: string): void {
    this.set(connectionId, { status: 'connected', since: Date.now() });
  }

  public markLost(connectionId: string, errorMessage?: string): void {
    this.set(connectionId, { status: 'lost', errorMessage, since: Date.now() });
  }

  public markIdle(connectionId: string): void {
    this.set(connectionId, { status: 'idle', since: Date.now() });
  }

  private set(connectionId: string, info: ConnectionStateInfo): void {
    if (!connectionId) {
      return;
    }
    const previous = this.get(connectionId).status;
    if (previous === info.status && info.status !== 'lost') {
      return;
    }
    this.states.set(connectionId, info);
    this.emitter.fire({ connectionId, info, previous });
  }

  /**
   * True when an error means "the socket/session is gone", as opposed to a bad
   * query. These are the errors worth retrying on a fresh connection.
   */
  public static isConnectionError(err: any): boolean {
    const msg = String(err?.message || err || '');
    const code = String(err?.code || '');

    if (err?.fatal === true) {
      return true;
    }

    // A driver whose socket was torn down mid-flight leaves a null handle behind,
    // which surfaces as "Cannot read properties of null (reading 'query')".
    if (/Cannot read propert(y|ies) of (null|undefined).*\b(query|execute|end)\b/i.test(msg)) {
      return true;
    }

    const messageMarkers = [
      'not queryable',
      'connection terminated',
      'connection lost',
      'connection closed',
      'closed state',
      'server closed the connection',
      'connection is closed',
      'client has encountered a connection error',
      'read econnreset',
      'socket hang up',
      'terminating connection',
      'timeout expired',
      'connection refused',
    ];
    const lower = msg.toLowerCase();
    if (messageMarkers.some((m) => lower.includes(m))) {
      return true;
    }

    const codes = [
      'ECONNRESET',
      'EPIPE',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENOTFOUND',
      'ENETDOWN',
      'ENETUNREACH',
      'PROTOCOL_CONNECTION_LOST',
      'PIPE_CLOSED',
      'CONNECTION_CLOSED',
      // PostgreSQL: admin shutdown / crash shutdown / cannot connect now
      '57P01',
      '57P02',
      '57P03',
      '08006',
      '08003',
      '08001',
    ];
    return codes.includes(code) || codes.some((c) => msg.includes(c));
  }
}
