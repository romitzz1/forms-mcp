// ABOUTME: Unit tests for export configuration parsing (dir resolution, clamps, base URL)
// ABOUTME: Pure function under test — env and home dir are injected

import * as path from 'node:path';
import { loadExportConfig } from '../../utils/exportConfig';

const HOME = '/home/tester';

describe('loadExportConfig', () => {
  it('defaults to stdio, ~/.gravity-forms-mcp/exports, 7 days, 60 minutes', () => {
    const c = loadExportConfig({}, HOME);
    expect(c.mode).toBe('stdio');
    expect(c.exportDir).toBe(path.join(HOME, '.gravity-forms-mcp', 'exports'));
    expect(c.retentionDays).toBe(7);
    expect(c.linkTtlMinutes).toBe(60);
    expect(c.publicBaseUrl).toBeUndefined();
    expect(c.warnings).toEqual([]);
  });

  it('expands a leading ~ and keeps absolute paths', () => {
    expect(loadExportConfig({ GRAVITY_FORMS_EXPORT_DIR: '~/exp' }, HOME).exportDir).toBe(path.join(HOME, 'exp'));
    expect(loadExportConfig({ GRAVITY_FORMS_EXPORT_DIR: '/exports' }, HOME).exportDir).toBe('/exports');
  });

  it('rejects a relative dir with a warning and uses the default', () => {
    const c = loadExportConfig({ GRAVITY_FORMS_EXPORT_DIR: './exports' }, HOME);
    expect(c.exportDir).toBe(path.join(HOME, '.gravity-forms-mcp', 'exports'));
    expect(c.warnings.join('\n')).toContain('GRAVITY_FORMS_EXPORT_DIR must be absolute');
  });

  it('falls back to defaults for out-of-range or invalid numbers', () => {
    const c = loadExportConfig({
      GRAVITY_FORMS_EXPORT_RETENTION_DAYS: '0',
      EXPORT_LINK_TTL_MINUTES: 'soon',
    }, HOME);
    expect(c.retentionDays).toBe(7);
    expect(c.linkTtlMinutes).toBe(60);
    expect(loadExportConfig({ GRAVITY_FORMS_EXPORT_RETENTION_DAYS: '30' }, HOME).retentionDays).toBe(30);
  });

  it('warns when a clamped value is out of range or not a number', () => {
    const outOfRange = loadExportConfig({ GRAVITY_FORMS_EXPORT_RETENTION_DAYS: '400' }, HOME);
    expect(outOfRange.retentionDays).toBe(7);
    expect(outOfRange.warnings).toContain('GRAVITY_FORMS_EXPORT_RETENTION_DAYS=400 is outside 1-365; using 7');

    const notANumber = loadExportConfig({ EXPORT_LINK_TTL_MINUTES: 'soon' }, HOME);
    expect(notANumber.linkTtlMinutes).toBe(60);
    expect(notANumber.warnings).toContain('EXPORT_LINK_TTL_MINUTES=soon is not a number; using 60');

    const inRange = loadExportConfig({ GRAVITY_FORMS_EXPORT_RETENTION_DAYS: '30' }, HOME);
    expect(inRange.warnings).toEqual([]);
  });

  it('accepts an http(s) base URL, strips trailing slashes, and warns when missing in http mode', () => {
    const ok = loadExportConfig({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: 't', MCP_PUBLIC_BASE_URL: 'http://nas.local:9807//' }, HOME);
    expect(ok.mode).toBe('http');
    expect(ok.publicBaseUrl).toBe('http://nas.local:9807');
    expect(ok.authToken).toBe('t');
    expect(ok.warnings).toEqual([]);

    const missing = loadExportConfig({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: 't' }, HOME);
    expect(missing.publicBaseUrl).toBeUndefined();
    expect(missing.warnings.join('\n')).toContain('MCP_PUBLIC_BASE_URL is not set');

    const bad = loadExportConfig({ MCP_TRANSPORT: 'http', MCP_AUTH_TOKEN: 't', MCP_PUBLIC_BASE_URL: 'nas.local:9807' }, HOME);
    expect(bad.publicBaseUrl).toBeUndefined();
    expect(bad.warnings.join('\n')).toContain('MCP_PUBLIC_BASE_URL must start with http:// or https://');
  });

  it('ignores the base URL in stdio mode without warning', () => {
    const c = loadExportConfig({ MCP_PUBLIC_BASE_URL: 'http://x:1' }, HOME);
    expect(c.publicBaseUrl).toBeUndefined();
    expect(c.warnings).toEqual([]);
  });
});
