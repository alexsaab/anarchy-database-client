export interface ParsedHost {
  protocol: 'http' | 'https';
  hostname: string;
  port: number;
  /** Path prefix, when the endpoint lives behind a reverse proxy. '' for none. */
  basePath: string;
  /** Convenience: protocol://hostname:port + basePath */
  url: string;
}

export interface ParseHostOptions {
  /** Port to use when neither the host string nor the config carries one. */
  defaultPort: number;
  /** Port from the connection profile, used when the host string has none. */
  configPort?: number;
  /** SSL checkbox from the connection profile; a scheme in the host wins over it. */
  ssl?: boolean;
}

/**
 * Turns whatever a user typed into the Host field into usable connection parts.
 *
 * People paste full endpoint URLs ("http://10.0.0.1:9200") into a field that is
 * then concatenated as `${protocol}://${host}:${port}`, which yields
 * "http://http://10.0.0.1:9200:9200" and a DNS lookup for the host "http".
 * Accept the URL form instead of failing on it.
 */
export function parseHost(rawHost: string | undefined, options: ParseHostOptions): ParsedHost {
  const { defaultPort, configPort, ssl } = options;

  let value = String(rawHost || '').trim();
  let protocol: 'http' | 'https' | null = null;
  let basePath = '';

  // Strip a scheme if one was pasted in, and let it decide http vs https.
  const schemeMatch = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'https') {
      protocol = 'https';
    } else if (scheme === 'http') {
      protocol = 'http';
    }
    value = value.slice(schemeMatch[0].length);
  }

  // Drop any credentials embedded in the URL (user:pass@host).
  const atIndex = value.lastIndexOf('@');
  if (atIndex !== -1) {
    value = value.slice(atIndex + 1);
  }

  // Split off a path/query, keeping it as a base path for proxied endpoints.
  const pathIndex = value.search(/[/?#]/);
  if (pathIndex !== -1) {
    basePath = value.slice(pathIndex).replace(/[?#].*$/, '').replace(/\/+$/, '');
    value = value.slice(0, pathIndex);
  }

  let hostname = value;
  let port: number | null = null;

  const ipv6Match = value.match(/^\[([^\]]+)\](?::(\d+))?/);
  if (ipv6Match) {
    hostname = ipv6Match[1];
    if (ipv6Match[2]) {
      port = parseInt(ipv6Match[2], 10);
    }
  } else {
    // Tolerate a duplicated port ("host:9200:9200"): the first one wins.
    const parts = value.split(':');
    hostname = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const candidate = parseInt(parts[i], 10);
      if (!isNaN(candidate) && candidate > 0 && candidate <= 65535) {
        port = candidate;
        break;
      }
    }
  }

  hostname = hostname.trim();
  if (!hostname) {
    hostname = 'localhost';
  }

  if (port === null) {
    port = configPort && configPort > 0 ? configPort : defaultPort;
  }

  const finalProtocol: 'http' | 'https' = protocol || (ssl ? 'https' : 'http');
  const hostPart = hostname.includes(':') ? `[${hostname}]` : hostname;

  return {
    protocol: finalProtocol,
    hostname,
    port,
    basePath,
    url: `${finalProtocol}://${hostPart}:${port}${basePath}`,
  };
}
