import { RedisOptions } from 'ioredis';

function getEnvVar(key: string, fallback?: string): string | undefined {
  const value = process.env[key];
  if (value !== undefined && value !== '') {
    return value;
  }
  return fallback;
}

export function getRedisConfig(): RedisOptions {
  return {
    host: getEnvVar('REDIS_HOST', '127.0.0.1'),
    port: Number(getEnvVar('REDIS_PORT', '6379')),
    password: getEnvVar('REDIS_PASSWORD'),
    db: Number(getEnvVar('REDIS_DB', '0')),
    maxRetriesPerRequest: null,
  };
}

