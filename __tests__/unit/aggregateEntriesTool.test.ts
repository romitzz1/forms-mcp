// ABOUTME: Unit tests for the aggregate_entries tool handler
// ABOUTME: Covers value tallies, multi-select sub-inputs, labels, paging cap, and filters

import { aggregateEntries, AggregateEntriesToolContext } from '../../utils/aggregateEntriesTools';

function makeCtx(handler: (endpoint: string) => any): AggregateEntriesToolContext {
  return {
    makeRequest: jest.fn(async (endpoint: string) => handler(endpoint))
  };
}

// Routes /forms/{id}/entries to a paged entry source and /forms/{id} to a form definition.
// When withTotalCount is true, entry pages carry the API's total_count (as GF v2 does).
function routed(entries: any[], form: any = { fields: [] }, pageSize = 100, withTotalCount = false) {
  return (endpoint: string) => {
    if (/\/forms\/\d+\/entries/.test(endpoint)) {
      // URLSearchParams percent-encodes the brackets, so match both raw and encoded forms.
      const pageMatch = endpoint.match(/paging(?:\[|%5B)current_page(?:\]|%5D)=(\d+)/i);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      const start = (page - 1) * pageSize;
      const pageEntries = entries.slice(start, start + pageSize);
      return withTotalCount ? { entries: pageEntries, total_count: entries.length } : { entries: pageEntries };
    }
    return form; // /forms/{id}
  };
}

describe('aggregate_entries', () => {
  it('tallies distinct values for a simple field, sorted by count desc', async () => {
    const entries = [
      { id: '1', '6': 'Beginner' },
      { id: '2', '6': 'Advanced' },
      { id: '3', '6': 'Beginner' },
      { id: '4', '6': 'Beginner' }
    ];
    const ctx = makeCtx(routed(entries, { fields: [{ id: 6, label: 'Experience' }] }));

    const result = await aggregateEntries(ctx, { form_id: '309', field_ids: ['6'] });
    const parsed = JSON.parse(result.content[0].text.slice(result.content[0].text.indexOf('{')));

    const field = parsed.fields[0];
    expect(field.label).toBe('Experience');
    expect(field.total_responses).toBe(4);
    expect(field.distinct_values).toBe(2);
    expect(field.distribution).toEqual([
      { value: 'Beginner', count: 3 },
      { value: 'Advanced', count: 1 }
    ]);
  });

  it('tallies each selected option across checkbox sub-inputs', async () => {
    const entries = [
      { id: '1', '12.1': 'Monday League', '12.2': 'Learn to Curl' },
      { id: '2', '12.1': 'Monday League' },
      { id: '3', '12.2': 'Learn to Curl', '12.3': 'Bonspiel' }
    ];
    const ctx = makeCtx(routed(entries, { fields: [{ id: 12, label: 'Interests' }] }));

    const result = await aggregateEntries(ctx, { form_id: '309', field_ids: ['12'] });
    const parsed = JSON.parse(result.content[0].text.slice(result.content[0].text.indexOf('{')));

    const field = parsed.fields[0];
    // Every entry selected at least one option -> 3 responses; counts sum > responses.
    expect(field.total_responses).toBe(3);
    expect(field.distribution).toEqual([
      { value: 'Learn to Curl', count: 2 },
      { value: 'Monday League', count: 2 },
      { value: 'Bonspiel', count: 1 }
    ]);
  });

  it('does not let field "1" bleed into field "12" (anchored key match)', async () => {
    const entries = [
      { id: '1', '1': 'one', '12': 'twelve' },
      { id: '2', '1': 'one', '12': 'twelve' }
    ];
    const ctx = makeCtx(routed(entries));

    const result = await aggregateEntries(ctx, { form_id: '5', field_ids: ['1'] });
    const parsed = JSON.parse(result.content[0].text.slice(result.content[0].text.indexOf('{')));

    expect(parsed.fields[0].distribution).toEqual([{ value: 'one', count: 2 }]);
  });

  it('falls back to "Field N" label when the form lookup fails', async () => {
    const entries = [{ id: '1', '6': 'X' }];
    const ctx: AggregateEntriesToolContext = {
      makeRequest: jest.fn(async (endpoint: string) => {
        if (/\/entries/.test(endpoint)) return { entries };
        throw new Error('form fetch failed');
      })
    };

    const result = await aggregateEntries(ctx, { form_id: '7', field_ids: ['6'] });
    expect(result.content[0].text).toContain('Field 6 — "Field 6"');
  });

  it('caps the scan at max_entries and flags it', async () => {
    const entries = Array.from({ length: 250 }, (_, i) => ({ id: String(i), '6': 'A' }));
    const ctx = makeCtx(routed(entries, { fields: [{ id: 6, label: 'Q' }] }));

    const result = await aggregateEntries(ctx, { form_id: '309', field_ids: ['6'], max_entries: 150 });
    const text = result.content[0].text;

    expect(text).toContain('Scan capped at max_entries=150');
    const parsed = JSON.parse(text.slice(text.indexOf('{')));
    expect(parsed.entries_scanned).toBe(150);
    expect(parsed.capped).toBe(true);
    expect(parsed.fields[0].distribution[0].count).toBe(150);
  });

  it('flags capped via total_count even when max_entries lands on a page boundary', async () => {
    // 205 entries, cap 200 (a multiple of the 100 page size). Without total_count the
    // scan would stop at exactly 200 and wrongly claim it was complete.
    const entries = Array.from({ length: 205 }, (_, i) => ({ id: String(i), '6': 'A' }));
    const ctx = makeCtx(routed(entries, { fields: [{ id: 6, label: 'Q' }] }, 100, true));

    const result = await aggregateEntries(ctx, { form_id: '309', field_ids: ['6'], max_entries: 200 });
    const text = result.content[0].text;

    expect(text).toContain('Scan capped at max_entries=200');
    const parsed = JSON.parse(text.slice(text.indexOf('{')));
    expect(parsed.entries_scanned).toBe(200);
    expect(parsed.capped).toBe(true);
  });

  it('does not flag capped when total_count equals the number scanned', async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({ id: String(i), '6': 'A' }));
    const ctx = makeCtx(routed(entries, { fields: [{ id: 6, label: 'Q' }] }, 100, true));

    const result = await aggregateEntries(ctx, { form_id: '309', field_ids: ['6'] });
    const parsed = JSON.parse(result.content[0].text.slice(result.content[0].text.indexOf('{')));
    expect(parsed.entries_scanned).toBe(200);
    expect(parsed.capped).toBe(false);
  });

  it('limits distinct values per field when top is given', async () => {
    const entries = [
      { id: '1', '6': 'A' }, { id: '2', '6': 'A' }, { id: '3', '6': 'A' },
      { id: '4', '6': 'B' }, { id: '5', '6': 'B' },
      { id: '6', '6': 'C' }
    ];
    const ctx = makeCtx(routed(entries, { fields: [{ id: 6, label: 'Q' }] }));

    const result = await aggregateEntries(ctx, { form_id: '309', field_ids: ['6'], top: 2 });
    const parsed = JSON.parse(result.content[0].text.slice(result.content[0].text.indexOf('{')));

    const field = parsed.fields[0];
    expect(field.distinct_values).toBe(3);          // full distinct count preserved
    expect(field.distribution).toEqual([            // but only top 2 returned
      { value: 'A', count: 3 },
      { value: 'B', count: 2 }
    ]);
  });

  it('passes status and field_filters through to the entries search param', async () => {
    const requests: string[] = [];
    const ctx: AggregateEntriesToolContext = {
      makeRequest: jest.fn(async (endpoint: string) => {
        requests.push(endpoint);
        if (/\/entries/.test(endpoint)) return { entries: [{ id: '1', '6': 'A' }] };
        return { fields: [] };
      })
    };

    await aggregateEntries(ctx, {
      form_id: '309',
      field_ids: ['6'],
      search: { status: 'active', field_filters: [{ key: '6', value: 'A', operator: 'is' }] }
    });

    const entriesCall = requests.find(r => /\/entries/.test(r))!;
    const searchParam = decodeURIComponent(entriesCall.split('search=')[1].split('&')[0]);
    const search = JSON.parse(searchParam);
    expect(search.status).toBe('active');
    expect(search.field_filters).toEqual([{ key: '6', value: 'A', operator: 'is' }]);
  });

  it('returns a helpful message when field_ids is empty', async () => {
    const ctx = makeCtx(routed([{ id: '1', '6': 'A' }]));
    const result = await aggregateEntries(ctx, { form_id: '309', field_ids: [] });
    expect(result.content[0].text).toContain('No field_ids provided');
  });

  it('reports when no entries are found', async () => {
    const ctx = makeCtx(routed([]));
    const result = await aggregateEntries(ctx, { form_id: '309', field_ids: ['6'] });
    expect(result.content[0].text).toContain('No entries found');
  });
});
