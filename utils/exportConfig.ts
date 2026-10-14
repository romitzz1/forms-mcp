// ABOUTME: Parses export-related environment configuration (dir, retention, link TTL, base URL)
// ABOUTME: Invalid values fall back to defaults with warnings instead of throwing

import * as path from 'node:path';

export type TransportMode = 'stdio' | 'http';

export interface IExportConfig {
  mode: TransportMode;
  exportDir: string;
  retentionDays: number;
  linkTtlMinutes: number;
  publicBaseUrl: string | undefined;
  authToken: string | undefined;
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function parseClampedInt(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  warnings: string[]
): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    warnings.push(`${name}=${value} is not a number; using ${fallback}`);
    return fallback;
  }
  if (parsed < min || parsed > max) {
    warnings.push(`${name}=${value} is outside ${min}-${max}; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

function resolveExportDir(raw: string | undefined, homeDir: string, warnings: string[]): string {
  const fallback = path.join(homeDir, '.gravity-forms-mcp', 'exports');
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim();
  if (value === '~' || value.startsWith('~/')) return path.join(homeDir, value.slice(1));
  if (path.isAbsolute(value)) return value;
  warnings.push(`GRAVITY_FORMS_EXPORT_DIR must be absolute (got "${value}"); using ${fallback}`);
  return fallback;
}

function resolveBaseUrl(raw: string | undefined, mode: TransportMode, warnings: string[]): string | undefined {
  if (mode !== 'http') return undefined;
  if (raw === undefined || raw.trim() === '') {
    warnings.push('MCP_PUBLIC_BASE_URL is not set; export download links are disabled');
    return undefined;
  }
  const value = raw.trim();
  if (!/^https?:\/\//.test(value)) {
    warnings.push('MCP_PUBLIC_BASE_URL must start with http:// or https://; export download links are disabled');
    return undefined;
  }
  return value.replace(/\/+$/, '');
}

export function loadExportConfig(env: Env, homeDir: string): IExportConfig {
  const warnings: string[] = [];
  const mode: TransportMode = env.MCP_TRANSPORT === 'http' ? 'http' : 'stdio';
  return {
    mode,
    exportDir: resolveExportDir(env.GRAVITY_FORMS_EXPORT_DIR, homeDir, warnings),
    retentionDays: parseClampedInt('GRAVITY_FORMS_EXPORT_RETENTION_DAYS', env.GRAVITY_FORMS_EXPORT_RETENTION_DAYS, 7, 1, 365, warnings),
    linkTtlMinutes: parseClampedInt('EXPORT_LINK_TTL_MINUTES', env.EXPORT_LINK_TTL_MINUTES, 60, 1, 1440, warnings),
    publicBaseUrl: resolveBaseUrl(env.MCP_PUBLIC_BASE_URL, mode, warnings),
    authToken: env.MCP_AUTH_TOKEN ?? undefined,
    warnings,
  };
}
