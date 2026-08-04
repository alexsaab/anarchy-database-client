export type DatabaseType = 'PostgreSQL' | 'MySQL' | 'SQLite' | 'Redis' | 'MongoDB';

export type ConnectionColor = 'red' | 'green' | 'yellow' | 'blue' | 'purple' | 'orange' | 'default';

export interface ConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  group?: string;
  color?: ConnectionColor;
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  schema?: string;
  dbPath?: string; // For SQLite
  ssl?: boolean;
  ssh?: {
    enabled: boolean;
    host?: string;
    port?: number;
    username?: string;
    privateKeyPath?: string;
    usePrivateKey?: boolean;
  };
}

export interface SavedConnectionProfile extends ConnectionConfig {}
