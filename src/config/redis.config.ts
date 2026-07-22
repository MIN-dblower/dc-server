import { RedisOptions } from 'ioredis';

function getEnvVar(key: string, fallback?: string): string | undefined {
  const value = process.env[key];
  if (value !== undefined && value !== '') {
    return value;
  }
  return fallback;
}

/**
 * Set REDIS_URL to a full connection string (e.g. the URI shown in the
 * Redis Cloud console: redis://default:<password>@<host>:<port>, or
 * rediss://... if TLS is enabled) to use that directly. Otherwise falls
 * back to the discrete REDIS_HOST/PORT/USERNAME/PASSWORD/DB/TLS vars.
 */
export function getRedisConfig(): RedisOptions {
  const redisUrl = getEnvVar('REDIS_URL');

  if (redisUrl) {
    const parsed = new URL(redisUrl);
    const db = parsed.pathname.replace('/', '');
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      db: db ? Number(db) : 0,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }

  const useTls = getEnvVar('REDIS_TLS', 'false') === 'true';

  return {
    host: getEnvVar('REDIS_HOST', '127.0.0.1'),
    port: Number(getEnvVar('REDIS_PORT', '6379')),
    username: getEnvVar('REDIS_USERNAME'),
    password: getEnvVar('REDIS_PASSWORD'),
    db: Number(getEnvVar('REDIS_DB', '0')),
    tls: useTls ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
