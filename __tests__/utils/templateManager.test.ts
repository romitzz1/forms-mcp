// ABOUTME: Comprehensive tests for TemplateManager class with cache integration support
// ABOUTME: Tests both API-only and cached forms scenarios for complete template discovery

import { TemplateManager, TemplateInfo } from '../../utils/templateManager.js';

describe('TemplateManager', () => {
  describe('Basic template identification', () => {
    let templateManager: TemplateManager;

    beforeEach(() => {
      templateManager = new TemplateManager();
    });

    it('should identify templates by title suffix', () => {
      const templateForm = {
        id: '1',
        title: 'Contact Form-template',
        fields: [{ id: '1', type: 'text', label: 'Name' }]
      };

      const regularForm = {
        id: '2',
        title: 'Contact Form',
        fields: [{ id: '1', type: 'text', label: 'Name' }]
      };

      expect(templateManager.isTemplate(templateForm)).toBe(true);
      expect(templateManager.isTemplate(regularForm)).toBe(false);
    });

    it('should generate template names correctly', () => {
      expect(templateManager.generateTemplateName('Contact Form')).toBe('Contact Form-template');
      expect(templateManager.generateTemplateName('Survey-template')).toBe('Survey-template');
      expect(templateManager.generateTemplateName('')).toBe('untitled-template');
      expect(templateManager.generateTemplateName(null)).toBe('untitled-template');
    });

    it('should validate template structure', () => {
      const validTemplate = {
        id: '1',
        title: 'Valid Template-template',
        fields: [{ id: '1', type: 'text', label: 'Name' }]
      };

      const invalidTemplate = {
        id: '2',
        title: 'Invalid Template-template',
        fields: []
      };

      expect(templateManager.validateTemplateStructure(validTemplate)).toBe(true);
      expect(templateManager.validateTemplateStructure(invalidTemplate)).toBe(false);
    });
  });

  describe('API-based template listing', () => {
    it('should list templates from API call', async () => {
      const mockForms = [
        {
          id: '1',
          title: 'Contact Form-template',
          description: 'Template for contact forms',
          fields: [
            { id: '1', type: 'text', label: 'Name' },
            { id: '2', type: 'email', label: 'Email' }
          ],
          date_created: '2023-01-01 12:00:00'
        },
        {
          id: '2',
          title: 'Regular Form',
          description: 'Not a template',
          fields: [{ id: '1', type: 'text', label: 'Field' }],
          date_created: '2023-01-02 12:00:00'
        },
        {
          id: '3',
          title: 'Survey Template-template',
          description: 'Survey template',
          fields: [
            { id: '1', type: 'text', label: 'Question 1' },
            { id: '2', type: 'textarea', label: 'Comments' }
          ],
          date_created: '2023-01-03 12:00:00'
        }
      ];

      const mockApiCall = jest.fn().mockResolvedValue(mockForms);
      const templateManager = new TemplateManager(mockApiCall);

      const templates = await templateManager.listTemplates();

      expect(mockApiCall).toHaveBeenCalledWith('/forms');
      expect(templates).toHaveLength(2);
      
      expect(templates[0]).toEqual({
        id: '1',
        name: 'Contact Form-template',
        description: 'Template for contact forms',
        field_count: 2,
        created_date: '2023-01-01 12:00:00'
      });

      expect(templates[1]).toEqual({
        id: '3',
        name: 'Survey Template-template',
        description: 'Survey template',
        field_count: 2,
        created_date: '2023-01-03 12:00:00'
      });
    });

    it('should handle API errors gracefully', async () => {
      const mockApiCall = jest.fn().mockRejectedValue(new Error('API Error'));
      const templateManager = new TemplateManager(mockApiCall);

      await expect(templateManager.listTemplates()).rejects.toThrow('API Error');
    });

    it('should handle empty API response', async () => {
      const mockApiCall = jest.fn().mockResolvedValue([]);
      const templateManager = new TemplateManager(mockApiCall);

      const templates = await templateManager.listTemplates();

      expect(templates).toHaveLength(0);
    });

    it('should require API call function', async () => {
      const templateManager = new TemplateManager();

      await expect(templateManager.listTemplates()).rejects.toThrow('API call function not provided to TemplateManager');
    });
  });

  describe('Cached forms template listing', () => {
    it('should list templates from provided forms array', async () => {
      const cachedForms = [
        {
          id: '1',
          title: 'Active Template-template',
          description: 'Active template',
          fields: [{ id: '1', type: 'text', label: 'Field 1' }],
          date_created: '2023-01-01 12:00:00',
          is_active: true
        },
        {
          id: '2',
          title: 'Inactive Template-template',
          description: 'Inactive template',
          fields: [{ id: '1', type: 'text', label: 'Field 2' }],
          date_created: '2023-01-02 12:00:00',
          is_active: false
        },
        {
          id: '3',
          title: 'Regular Form',
          description: 'Not a template',
          fields: [{ id: '1', type: 'text', label: 'Field 3' }],
          date_created: '2023-01-03 12:00:00',
          is_active: true
        }
      ];

      const templateManager = new TemplateManager();
      const templates = await templateManager.listTemplates(cachedForms);

      expect(templates).toHaveLength(2);
      
      expect(templates[0]).toEqual({
        id: '1',
        name: 'Active Template-template',
        description: 'Active template',
        field_count: 1,
        created_date: '2023-01-01 12:00:00'
      });

      expect(templates[1]).toEqual({
        id: '2',
        name: 'Inactive Template-template',
        description: 'Inactive template',
        field_count: 1,
        created_date: '2023-01-02 12:00:00'
      });
    });

    it('should work with cached forms that have missing optional fields', async () => {
      const cachedForms = [
        {
          id: '1',
          title: 'Minimal Template-template',
          // Missing description and date_created
          fields: [{ id: '1', type: 'text', label: 'Field 1' }]
        }
      ];

      const templateManager = new TemplateManager();
      const templates = await templateManager.listTemplates(cachedForms);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toEqual({
        id: '1',
        name: 'Minimal Template-template',
        description: '',
        field_count: 1,
        created_date: ''
      });
    });

    it('should filter out templates with invalid structure from cached forms', async () => {
      const cachedForms = [
        {
          id: '1',
          title: 'Valid Template-template',
          fields: [{ id: '1', type: 'text', label: 'Field 1' }]
        },
        {
          id: '2',
          title: 'Invalid Template-template',
          fields: [] // No fields - invalid
        },
        {
          id: '3',
          title: 'Another Invalid Template-template',
          // Missing fields array - invalid
        }
      ];

      const templateManager = new TemplateManager();
      const templates = await templateManager.listTemplates(cachedForms);

      expect(templates).toHaveLength(1);
      expect(templates[0].id).toBe('1');
    });

    it('should handle null or undefined cached forms array', async () => {
      // When null or undefined is explicitly passed, it should use API
      // So we need to provide an API function or it should return empty
      const mockApiCall = jest.fn().mockResolvedValue([]);
      const templateManager = new TemplateManager(mockApiCall);
      
      // Passing null should trigger API call (original behavior)
      const templatesFromNull = await templateManager.listTemplates(null);
      expect(templatesFromNull).toHaveLength(0);
      expect(mockApiCall).toHaveBeenCalledTimes(1);
      
      // Reset mock
      mockApiCall.mockClear();
      
      // Passing undefined should also trigger API call (original behavior)
      const templatesFromUndefined = await templateManager.listTemplates(undefined);
      expect(templatesFromUndefined).toHaveLength(0);
      expect(mockApiCall).toHaveBeenCalledTimes(1);
    });

    it('should handle empty cached forms array', async () => {
      const templateManager = new TemplateManager();
      const templates = await templateManager.listTemplates([]);

      expect(templates).toHaveLength(0);
    });
  });

  describe('Backward compatibility', () => {
    it('should use API call when no forms array provided and API available', async () => {
      const mockForms = [
        {
          id: '1',
          title: 'API Template-template',
          description: 'From API',
          fields: [{ id: '1', type: 'text', label: 'Field' }],
          date_created: '2023-01-01 12:00:00'
        }
      ];

      const mockApiCall = jest.fn().mockResolvedValue(mockForms);
      const templateManager = new TemplateManager(mockApiCall);

      const templates = await templateManager.listTemplates();

      expect(mockApiCall).toHaveBeenCalledWith('/forms');
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('API Template-template');
    });

    it('should prefer cached forms over API when both available', async () => {
      const mockApiForms = [
        {
          id: '1',
          title: 'API Template-template',
          description: 'From API',
          fields: [{ id: '1', type: 'text', label: 'Field' }],
          date_created: '2023-01-01 12:00:00'
        }
      ];

      const cachedForms = [
        {
          id: '2',
          title: 'Cached Template-template',
          description: 'From Cache',
          fields: [{ id: '1', type: 'text', label: 'Field' }],
          date_created: '2023-01-02 12:00:00'
        }
      ];

      const mockApiCall = jest.fn().mockResolvedValue(mockApiForms);
      const templateManager = new TemplateManager(mockApiCall);

      // When cached forms provided, should use cache and not call API
      const templates = await templateManager.listTemplates(cachedForms);

      expect(mockApiCall).not.toHaveBeenCalled();
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('Cached Template-template');
    });
  });

  describe('Template detection edge cases', () => {
    it('should handle templates with complex names', async () => {
      const complexForms = [
        {
          id: '1',
          title: 'Multi-word Complex Name-template',
          fields: [{ id: '1', type: 'text', label: 'Field' }]
        },
        {
          id: '2',
          title: 'Form with-dashes-template',
          fields: [{ id: '1', type: 'text', label: 'Field' }]
        },
        {
          id: '3',
          title: 'Template-template', // Minimal valid name
          fields: [{ id: '1', type: 'text', label: 'Field' }]
        }
      ];

      const templateManager = new TemplateManager();
      const templates = await templateManager.listTemplates(complexForms);

      expect(templates).toHaveLength(3);
      expect(templates.map(t => t.name)).toEqual([
        'Multi-word Complex Name-template',
        'Form with-dashes-template',
        'Template-template'
      ]);
    });

    it('should handle templates with special characters in descriptions', async () => {
      const formsWithSpecialChars = [
        {
          id: '1',
          title: 'Special Template-template',
          description: 'Template with "quotes" & symbols <html>',
          fields: [{ id: '1', type: 'text', label: 'Field' }]
        }
      ];

      const templateManager = new TemplateManager();
      const templates = await templateManager.listTemplates(formsWithSpecialChars);

      expect(templates).toHaveLength(1);
      expect(templates[0].description).toBe('Template with "quotes" & symbols <html>');
    });
  });
});