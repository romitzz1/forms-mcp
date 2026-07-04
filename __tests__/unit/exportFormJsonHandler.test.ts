// ABOUTME: Tests for the real export_form_json handler: disk write, summary response, sanitization
// ABOUTME: Complements exportFormJson.test.ts, which only exercises simulated export logic

import { exportFormJson, ExportToolContext } from '../../utils/exportTools';

function makeCtx(form: any, saveImpl?: (content: string, filename: string, formId?: string, outputPath?: string) => Promise<string>) {
  const saveContentToDisk = jest.fn(saveImpl ?? (async (_c, filename, formId) => `/exports/${formId}/${filename}`));
  const ctx = {
    makeRequest: jest.fn(async () => form),
    validator: {} as any,
    dataExporter: { saveContentToDisk } as any
  } as unknown as ExportToolContext;
  return { ctx, saveContentToDisk };
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
  it('writes the JSON to disk and returns a path + summary without inlining json_data', async () => {
    const { ctx, saveContentToDisk } = makeCtx(baseForm);

    const result = await exportFormJson(ctx, { form_id: '5' });
    const parsed = JSON.parse(result.content[0].text);

    expect(saveContentToDisk).toHaveBeenCalledTimes(1);
    expect(parsed.success).toBe(true);
    expect(parsed.file_path).toBe('/exports/5/form-5-customer-contact-form.json');
    expect(parsed.form_title).toBe('Customer Contact Form');
    expect(parsed.fields_count).toBe(1);
    expect(parsed.export_size).toBeGreaterThan(0);
    expect(parsed.json_data).toBeUndefined(); // no longer inlined
  });

  it('sanitizes sensitive data before writing to disk', async () => {
    let written = '';
    const { ctx } = makeCtx(baseForm, async (content) => { written = content; return '/exports/5/x.json'; });

    await exportFormJson(ctx, { form_id: '5' });
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

  it('honors an explicit filename and output_path', async () => {
    const { ctx, saveContentToDisk } = makeCtx(baseForm);

    await exportFormJson(ctx, { form_id: '5', filename: 'backup.json', output_path: '/tmp/forms' });

    expect(saveContentToDisk).toHaveBeenCalledWith(expect.any(String), 'backup.json', '5', '/tmp/forms');
  });

  it('defaults the filename slug to "form" when the title is empty', async () => {
    const { ctx, saveContentToDisk } = makeCtx({ id: '9', title: '', fields: [] });

    await exportFormJson(ctx, { form_id: '9' });

    expect(saveContentToDisk).toHaveBeenCalledWith(expect.any(String), 'form-9-form.json', '9', undefined);
  });

  it('throws for a missing form_id', async () => {
    const { ctx } = makeCtx(baseForm);
    await expect(exportFormJson(ctx, {})).rejects.toThrow('form_id is required');
  });
});
