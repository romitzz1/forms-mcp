// ABOUTME: Tests for the real export_form_json handler: store save, summary response, sanitization
// ABOUTME: Complements exportFormJson.test.ts, which only exercises simulated export logic

import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DataExporter } from '../../utils/dataExporter';
import { ExportStore } from '../../utils/exportStore';
import { exportFormJson, ExportToolContext, OUTPUT_PATH_REMOVED } from '../../utils/exportTools';
import { ValidationHelper } from '../../utils/validation';

function makeCtx(form: any, store: ExportStore) {
  const ctx = {
    makeRequest: jest.fn(async () => form),
    validator: new ValidationHelper(),
    dataExporter: new DataExporter(),
    getExportStore: () => store,
    delivery: { mode: 'stdio' as const, publicBaseUrl: undefined, linkKey: null, linkTtlMinutes: 60 },
  } as unknown as ExportToolContext;
  return { ctx };
}

const baseForm = {
  id: '5',
  title: 'Customer Contact Form',
  fields: [{ id: '1', type: 'text', label: 'Name' }],
  settings: { stripe: { publishableKey: 'pk_test_1', secretKey: 'sk_test_secret' } },
  notifications: [{ id: 'a', name: 'Admin', to: 'admin@example.com', apiKey: 'secret-key' }],
  date_created: '2023-01-01 12:00:00',
  is_active: '1'
};

describe('export_form_json handler', () => {
  let dir: string;
  let store: ExportStore;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gf-form-json-'));
    store = new ExportStore({ dir, retentionDays: 7 });
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('saves the JSON to the export store and returns a summary with a resource_link', async () => {
    const { ctx } = makeCtx(baseForm, store);

    const result = await exportFormJson(ctx, { form_id: '5' });

    const resourceLinks = result.content.filter((c) => c.type === 'resource_link');
    expect(resourceLinks).toHaveLength(1);
    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    expect(text).toContain('Customer Contact Form');
    expect(text).toContain('Fields: 1');
  });

  it('sanitizes sensitive data before writing to the store', async () => {
    const { ctx } = makeCtx(baseForm, store);

    const result = await exportFormJson(ctx, { form_id: '5' });
    const uri = result.content.find((c) => c.type === 'resource_link')?.uri ?? '';
    const id = uri.replace('gf-export://', '');
    const written = await store.readText(id, 1_000_000);
    const exported = JSON.parse(written);

    expect(exported.settings.stripe.secretKey).toBeUndefined();
    expect(exported.settings.stripe.publishableKey).toBe('pk_test_1');
    expect(exported.notifications[0].apiKey).toBeUndefined();
    expect(exported.notifications[0].to).toBe('{admin_email}');
    expect(exported.id).toBeUndefined();
    expect(exported.date_created).toBeUndefined();
    expect(exported.is_active).toBeUndefined();
    expect(exported.export_metadata.original_form_id).toBe('5');
  });

  it('rejects output_path', async () => {
    const { ctx } = makeCtx(baseForm, store);

    await expect(exportFormJson(ctx, { form_id: '5', output_path: '/tmp/forms' })).rejects.toThrow(OUTPUT_PATH_REMOVED);
  });

  it('honors an explicit filename, stored with a .json extension', async () => {
    const { ctx } = makeCtx(baseForm, store);

    const result = await exportFormJson(ctx, { form_id: '5', filename: 'backup' });
    const uri = result.content.find((c) => c.type === 'resource_link')?.uri ?? '';
    const id = uri.replace('gf-export://', '');
    const record = await store.get(id);

    expect(record.filename).toBe('backup.json');
  });

  it('defaults the filename slug to "form" when the title is empty', async () => {
    const { ctx } = makeCtx({ id: '9', title: '', fields: [] }, store);

    const result = await exportFormJson(ctx, { form_id: '9' });
    const uri = result.content.find((c) => c.type === 'resource_link')?.uri ?? '';
    const id = uri.replace('gf-export://', '');
    const record = await store.get(id);

    expect(record.filename).toBe('form-9-form.json');
  });

  it('throws for a missing form_id', async () => {
    const { ctx } = makeCtx(baseForm, store);
    await expect(exportFormJson(ctx, {})).rejects.toThrow('form_id is required');
  });
});
