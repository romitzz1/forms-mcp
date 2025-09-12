// ABOUTME: Tests for FormImporter integration with FormCache for complete conflict detection
// ABOUTME: Tests enhanced conflict detection, cache usage, and backward compatibility

import { FormImporter } from '../../utils/formImporter.js';
import { FormCache } from '../../utils/formCache.js';
import { DatabaseManager } from '../../utils/database.js';

describe('FormImporter FormCache Integration', () => {
  let mockApiCall: jest.MockedFunction<any>;
  let formCache: FormCache;
  let formImporter: FormImporter;
  let tempDbPath: string;

  beforeEach(async () => {
    mockApiCall = jest.fn();
    
    // Create in-memory database for testing
    tempDbPath = ':memory:';
    formCache = new FormCache(tempDbPath);
    await formCache.init();
    
    // Create FormImporter with FormCache
    formImporter = new FormImporter(mockApiCall, formCache);
  });

  afterEach(async () => {
    await formCache.close();
    jest.clearAllMocks();
  });

  describe('Constructor Integration', () => {
    it('should accept optional FormCache parameter', () => {
      const importer = new FormImporter(mockApiCall, formCache);
      expect(importer).toBeDefined();
    });

    it('should work without FormCache for backward compatibility', () => {
      const importer = new FormImporter(mockApiCall);
      expect(importer).toBeDefined();
    });
  });

  describe('Enhanced Conflict Detection', () => {
    const importedForm = {
      title: 'Inactive Template Form',
      fields: [
        { id: '1', type: 'text', label: 'Name' }
      ]
    };

    it('should detect conflicts with active forms when using complete discovery', async () => {
      // Setup cache with forms directly (no API calls needed)
      await formCache.insertForm({
        id: 1,
        title: 'Active Form',
        is_active: true
      });
      await formCache.insertForm({
        id: 2,
        title: 'Inactive Template Form',
        is_active: true
      });
      
      const conflictInfo = await formImporter.detectConflicts(importedForm, true);
      
      expect(conflictInfo.hasConflict).toBe(true);
      expect(conflictInfo.conflictType).toBe('title');
      expect(conflictInfo.conflictDetails?.title).toBe('Inactive Template Form');
      
      // Should not make API calls when cache is fresh
      expect(mockApiCall).not.toHaveBeenCalled();
    });

    it('should detect conflicts with inactive forms when using complete discovery', async () => {
      // Setup cache with active and inactive forms
      await formCache.insertForm({
        id: 1,
        title: 'Active Form',
        is_active: true,
        entry_count: 5
      });
      await formCache.insertForm({
        id: 2,
        title: 'Inactive Template Form',
        is_active: false,
        entry_count: 0
      });
      
      const conflictInfo = await formImporter.detectConflicts(importedForm, true);
      
      expect(conflictInfo.hasConflict).toBe(true);
      expect(conflictInfo.conflictType).toBe('title');
      expect(conflictInfo.conflictDetails?.existingId).toBe('2');
      
      // Should not make API calls when using cached data
      expect(mockApiCall).not.toHaveBeenCalled();
    });

    it('should not detect conflicts with inactive forms when using API-only mode', async () => {
      // Setup cache with active and inactive forms
      await formCache.insertForm({
        id: 1,
        title: 'Active Form',
        is_active: true
      });
      await formCache.insertForm({
        id: 2,
        title: 'Inactive Template Form',
        is_active: false
      });
      
      // Mock API response (active forms only)
      mockApiCall.mockResolvedValueOnce({
        "1": { id: '1', title: 'Active Form', is_active: '1' }
      });
      
      const conflictInfo = await formImporter.detectConflicts(importedForm, false);
      
      expect(conflictInfo.hasConflict).toBe(false);
      expect(conflictInfo.conflictType).toBe('none');
      
      // Should make API call for original behavior
      expect(mockApiCall).toHaveBeenCalledWith('/forms');
    });

    it('should fall back to API calls when cache unavailable', async () => {
      // Create importer without cache
      const noCacheImporter = new FormImporter(mockApiCall);
      
      mockApiCall.mockResolvedValueOnce({
        "1": { id: '1', title: 'API Form', is_active: '1' }
      });
      
      const conflictInfo = await noCacheImporter.detectConflicts(importedForm, true);
      
      expect(conflictInfo.hasConflict).toBe(false);
      
      // Should fall back to API call
      expect(mockApiCall).toHaveBeenCalledWith('/forms');
    });

    it('should auto-sync cache when stale and using complete discovery', async () => {
      // Test that empty cache triggers sync when using complete discovery
      // (empty cache is always considered stale)
      
      // Mock API response for sync process
      mockApiCall.mockResolvedValue([
        { id: '1', title: 'API Form', is_active: '1' }
      ]);
      
      const testForm = {
        title: 'Non-Conflicting Form',
        fields: []
      };
      
      const conflictInfo = await formImporter.detectConflicts(testForm, true);
      
      expect(conflictInfo.hasConflict).toBe(false);
      
      // Should have synced cache since it was empty (verify API was called)
      expect(mockApiCall).toHaveBeenCalled();
    });

    it('should handle mixed scenarios with some forms in cache', async () => {
      // Add some forms to cache
      await formCache.insertForm({
        id: 1,
        title: 'Cached Active Form',
        is_active: true
      });
      await formCache.insertForm({
        id: 3,
        title: 'Cached Inactive Form',
        is_active: false
      });
      
      // Mock API for fresh sync (complete discovery should refresh cache)
      mockApiCall.mockResolvedValueOnce({
        "1": { id: '1', title: 'Cached Active Form', is_active: '1' },
        "2": { id: '2', title: 'New Active Form', is_active: '1' }
      });
      
      const testForm = {
        title: 'Cached Inactive Form',
        fields: []
      };
      
      const conflictInfo = await formImporter.detectConflicts(testForm, true);
      
      expect(conflictInfo.hasConflict).toBe(true);
      expect(conflictInfo.conflictType).toBe('title');
    });
  });

  describe('Enhanced Conflict Resolution', () => {
    it('should leverage cached form data for conflict resolution', async () => {
      // Setup cache with forms
      await formCache.insertForm({
        id: 1,
        title: 'Existing Form 1',
        is_active: true
      });
      await formCache.insertForm({
        id: 2,
        title: 'Contact Form (Import 1)',
        is_active: false
      });
      
      const importedForm = {
        title: 'Contact Form',
        fields: []
      };
      
      const conflictInfo = {
        hasConflict: true,
        conflictType: 'title' as const,
        conflictDetails: { existingId: '1', title: 'Contact Form' }
      };
      
      const resolvedForm = await formImporter.resolveConflicts(importedForm, conflictInfo, true);
      
      // Should generate unique title considering cached forms
      expect(resolvedForm.title).toBe('Contact Form (Import 2)');
      
      // Should not make additional API calls
      expect(mockApiCall).not.toHaveBeenCalled();
    });

    it('should fall back to API for conflict resolution when cache unavailable', async () => {
      const noCacheImporter = new FormImporter(mockApiCall);
      
      const importedForm = {
        title: 'Contact Form',
        fields: []
      };
      
      const conflictInfo = {
        hasConflict: true,
        conflictType: 'title' as const,
        conflictDetails: { existingId: '1', title: 'Contact Form' }
      };
      
      // Mock API response for conflict resolution
      mockApiCall.mockResolvedValueOnce({
        "1": { id: '1', title: 'Contact Form', is_active: '1' }
      });
      
      const resolvedForm = await noCacheImporter.resolveConflicts(importedForm, conflictInfo);
      
      expect(resolvedForm.title).toBe('Contact Form (Import 1)');
      
      // Should make API call for resolution
      expect(mockApiCall).toHaveBeenCalledWith('/forms');
    });

    it('should maintain backward compatibility without useCompleteDiscovery flag', async () => {
      // Setup cache but don't use complete discovery
      await formCache.insertForm({
        id: 1,
        title: 'Cached Form',
        is_active: false
      });
      
      const importedForm = {
        title: 'Cached Form',
        fields: []
      };
      
      // Mock API response (only active forms)
      mockApiCall.mockResolvedValueOnce({});
      
      const conflictInfo = await formImporter.detectConflicts(importedForm);
      
      expect(conflictInfo.hasConflict).toBe(false);
      
      // Should use API, not cache
      expect(mockApiCall).toHaveBeenCalledWith('/forms');
    });
  });

  describe('Error Handling', () => {
    it('should handle cache initialization failures gracefully', async () => {
      const failingCache = new FormCache('/invalid/path/forms.db');
      
      // Don't initialize cache to simulate failure
      const importerWithFailingCache = new FormImporter(mockApiCall, failingCache);
      
      mockApiCall.mockResolvedValueOnce({});
      
      const importedForm = {
        title: 'Test Form',
        fields: []
      };
      
      // Should fall back to API without throwing
      const conflictInfo = await importerWithFailingCache.detectConflicts(importedForm, true);
      
      expect(conflictInfo.hasConflict).toBe(false);
      expect(mockApiCall).toHaveBeenCalledWith('/forms');
    });

    it('should handle cache sync failures during conflict detection', async () => {
      // Close the cache to force a failure condition
      await formCache.close();
      
      // Mock API fallback
      mockApiCall.mockResolvedValueOnce({});
      
      // Try to use the importer with the closed cache
      const importedForm = {
        title: 'Test Form',
        fields: []
      };
      
      // Should fall back to API when cache operations fail with complete discovery
      const conflictInfo = await formImporter.detectConflicts(importedForm, true);
      
      expect(conflictInfo.hasConflict).toBe(false);
      expect(mockApiCall).toHaveBeenCalledWith('/forms');
    });

    it('should handle empty cache gracefully', async () => {
      const importedForm = {
        title: 'Test Form',
        fields: []
      };
      
      // Mock API response for sync
      mockApiCall.mockResolvedValueOnce({});
      
      const conflictInfo = await formImporter.detectConflicts(importedForm, true);
      
      expect(conflictInfo.hasConflict).toBe(false);
      expect(conflictInfo.conflictType).toBe('none');
    });
  });

  describe('Performance Optimization', () => {
    it('should reduce API calls when using cached data', async () => {
      // Setup fresh cache
      await formCache.insertForm({
        id: 1,
        title: 'Cached Form',
        is_active: true
      });
      
      const importedForm = {
        title: 'New Form',
        fields: []
      };
      
      const conflictInfo = await formImporter.detectConflicts(importedForm, true);
      
      expect(conflictInfo.hasConflict).toBe(false);
      
      // Should not make any API calls with fresh cache
      expect(mockApiCall).not.toHaveBeenCalled();
    });

    it('should batch cache access for multiple conflict checks', async () => {
      // Setup cache with multiple forms
      for (let i = 1; i <= 5; i++) {
        await formCache.insertForm({
          id: i,
          title: `Form ${i}`,
          is_active: i % 2 === 1
        });
      }
      
      const forms = [
        { title: 'New Form A', fields: [] },
        { title: 'New Form B', fields: [] },
        { title: 'Form 3', fields: [] } // This should conflict
      ];
      
      const results = await Promise.all(
        forms.map(form => formImporter.detectConflicts(form, true))
      );
      
      expect(results[0].hasConflict).toBe(false);
      expect(results[1].hasConflict).toBe(false);
      expect(results[2].hasConflict).toBe(true);
      expect(results[2].conflictDetails?.existingId).toBe('3');
      
      // Should not make any API calls with fresh cache
      expect(mockApiCall).not.toHaveBeenCalled();
    });
  });

  describe('Comprehensive Integration Tests', () => {
    it('should complete full import workflow with cache-based conflict detection', async () => {
      // Setup complex cache scenario
      await formCache.insertForm({
        id: 1,
        title: 'Active Form',
        is_active: true
      });
      await formCache.insertForm({
        id: 2,
        title: 'Inactive Template',
        is_active: false
      });
      
      const formJson = JSON.stringify({
        title: 'Inactive Template',
        fields: [
          { id: '1', type: 'text', label: 'Name' }
        ]
      });
      
      // Mock successful form creation
      mockApiCall.mockResolvedValueOnce({ id: '3', title: 'Inactive Template (Import 1)' });
      
      const importResult = await formImporter.importForm(formJson, { 
        useCompleteDiscovery: true 
      });
      
      expect(importResult.success).toBe(true);
      expect(importResult.action).toBe('created_with_modified_title');
      expect(importResult.form_title).toBe('Inactive Template (Import 1)');
      expect(importResult.conflicts_resolved).toBe(1);
      
      // Should only make API call for form creation, not conflict detection
      expect(mockApiCall).toHaveBeenCalledTimes(1);
      expect(mockApiCall).toHaveBeenCalledWith('/forms', 'POST', expect.any(Object));
    });

    it('should maintain backward compatibility in full import workflow', async () => {
      const noCacheImporter = new FormImporter(mockApiCall);
      
      const formJson = JSON.stringify({
        title: 'Test Form',
        fields: []
      });
      
      // Mock API responses for conflict detection and form creation
      mockApiCall
        .mockResolvedValueOnce({}) // Empty forms list
        .mockResolvedValueOnce({ id: '1', title: 'Test Form' }); // Form creation
      
      const importResult = await noCacheImporter.importForm(formJson);
      
      expect(importResult.success).toBe(true);
      expect(importResult.action).toBe('created');
      
      // Should make API calls for both conflict detection and form creation
      expect(mockApiCall).toHaveBeenCalledTimes(2);
    });
  });
});