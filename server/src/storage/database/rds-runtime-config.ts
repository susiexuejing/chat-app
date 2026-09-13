/**
 * EF-107 runtime-only configuration boundary.
 *
 * Values are supplied by the protected ECS server environment. This module
 * deliberately never reads files, logs values, or falls back to another
 * database/provider credential path.
 */
export interface RdsRuntimeConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export type RdsRuntimeConfigResult =
  | { ok: true; config: RdsRuntimeConfig }
  | { ok: false };

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,63}$/;
const SAFE_HOST = /^[A-Za-z0-9.-]{1,253}$/;

function exact(value: string | undefined, pattern: RegExp): string | null {
  return value && pattern.test(value) ? value : null;
}

function isBootstrapAdministrator(user: string): boolean {
  const normalized = user.toLowerCase();
  return normalized.includes('bootstrap') || normalized.includes('admin');
}

export function parseRdsRuntimeConfig(env: NodeJS.ProcessEnv): RdsRuntimeConfigResult {
  const host = exact(env.EF_RDS_RUNTIME_HOST, SAFE_HOST);
  const database = exact(env.EF_RDS_RUNTIME_DATABASE, SAFE_IDENTIFIER);
  const user = exact(env.EF_RDS_RUNTIME_USER, SAFE_IDENTIFIER);
  const password = env.EF_RDS_RUNTIME_PASSWORD;
  const portText = env.EF_RDS_RUNTIME_PORT;
  const port = portText && /^[0-9]{1,5}$/.test(portText) ? Number(portText) : NaN;

  if (!host || !database || !user || !password
    || !Number.isInteger(port) || port < 1 || port > 65535
    || isBootstrapAdministrator(user)) {
    return { ok: false };
  }

  return { ok: true, config: { host, port, database, user, password } };
}

export function readRdsRuntimeConfig(): RdsRuntimeConfigResult {
  return parseRdsRuntimeConfig(process.env);
}
