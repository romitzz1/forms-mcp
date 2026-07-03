// ABOUTME: Regression test for composite Gravity Forms Name field search (audit A1)
// ABOUTME: Verifies searchByName matches entries whose name lives only under sub-input keys (e.g. "6.3")

import { UniversalSearchManager } from '../../utils/universalSearchManager';
import { FieldTypeDetector } from '../../utils/fieldTypeDetector';

describe('UniversalSearchManager - composite Name field (real FieldTypeDetector)', () => {
  let fieldDetector: FieldTypeDetector;
  let searchManager: UniversalSearchManager;
  let mockApiClient: any;

  beforeEach(() => {
    // Use the real FieldTypeDetector (no mocking) so this test exercises the
    // actual field-type-detection/sub-input-expansion logic, not a stand-in.
    fieldDetector = new FieldTypeDetector();

    mockApiClient = {
      getFormDefinition: jest.fn(),
      searchEntries: jest.fn()
    };

    searchManager = new UniversalSearchManager(fieldDetector, mockApiClient);
  });

  it('finds an entry whose name is stored only under Name field sub-inputs ("6.3"/"6.6")', async () => {
    // Real Gravity Forms "name" field (advanced format): the parent field id "6"
    // never carries a value on the entry - only its sub-inputs do.
    const mockFormData = {
      id: '193',
      title: 'League Sign up 25-26',
      fields: [
        {
          id: '6',
          label: 'Name',
          type: 'name',
          inputs: [
            { id: '6.3', label: 'First' },
            { id: '6.6', label: 'Last' }
          ]
        }
      ]
    };

    // Entry has NO "6" key at all - only the sub-input keys.
    const mockEntry = {
      id: '999',
      form_id: '193',
      '6.3': 'Jane',
      '6.6': 'Doe'
    };

    mockApiClient.getFormDefinition.mockResolvedValue(mockFormData);
    mockApiClient.searchEntries.mockResolvedValue([mockEntry]);

    const result = await searchManager.searchByName('193', 'Jane');

    expect(result.totalFound).toBeGreaterThanOrEqual(1);
    expect(result.matches).toHaveLength(1);

    const match = result.matches[0];
    expect(match?.entryId).toBe('999');
    // The match must be captured from the sub-input, since the parent id "6"
    // is never present on the entry.
    expect(Object.keys(match?.matchedFields ?? {}).length).toBeGreaterThan(0);
    expect(Object.values(match?.matchedFields ?? {})).toContain('Jane');
  });
});
