// ABOUTME: Tests for TemplateManager class that handles form template identification
// ABOUTME: Covers template listing, validation, naming, and structure checking

import { TemplateManager } from '../../utils/templateManager.js';

describe('TemplateManager', () => {
  let templateManager: TemplateManager;

  beforeEach(() => {
    templateManager = new TemplateManager();
  });

  describe('isTemplate', () => {
    it('should identify forms with -template suffix as templates', () => {
      const templateForm = {
        id: '1',
        title: 'Contact Form-template',
        fields: []
      };
      
      expect(templateManager.isTemplate(templateForm)).toBe(true);
    });

    it('should not identify regular forms as templates', () => {
      const regularForm = {
        id: '1',
        title: 'Contact Form',
        fields: []
      };
      
      expect(templateManager.isTemplate(regularForm)).toBe(false);
    });

    it('should handle forms with -template in the middle of the name', () => {
      const form = {
        id: '1',
        title: 'Contact Form-template (V2)',
        fields: []
      };
      
      expect(templateManager.isTemplate(form)).toBe(false);
    });

    it('should handle case sensitivity', () => {
      const form = {
        id: '1',
        title: 'Contact Form-TEMPLATE',
        fields: []
      };
      
      expect(templateManager.isTemplate(form)).toBe(false);
    });

    it('should handle null or undefined forms', () => {
      expect(templateManager.isTemplate(null)).toBe(false);
      expect(templateManager.isTemplate(undefined)).toBe(false);
    });
  });

  describe('generateTemplateName', () => {
    it('should generate template name by adding -template suffix', () => {
      const result = templateManager.generateTemplateName('Contact Form');
      expect(result).toBe('Contact Form-template');
    });

    it('should not double-add template suffix', () => {
      const result = templateManager.generateTemplateName('Contact Form-template');
      expect(result).toBe('Contact Form-template');
    });

    it('should handle empty or null base names', () => {
      expect(templateManager.generateTemplateName('')).toBe('-template');
      expect(templateManager.generateTemplateName(null as any)).toBe('null-template');
    });
  });

  describe('validateTemplateStructure', () => {
    it('should validate forms with proper structure', () => {
      const validForm = {
        id: '1',
        title: 'Valid Form-template',
        fields: [
          { id: '1', type: 'text', label: 'Name' },
          { id: '2', type: 'email', label: 'Email' }
        ]
      };
      
      expect(templateManager.validateTemplateStructure(validForm)).toBe(true);
    });

    it('should reject forms without fields array', () => {
      const invalidForm = {
        id: '1',
        title: 'Invalid Form-template'
      };
      
      expect(templateManager.validateTemplateStructure(invalidForm)).toBe(false);
    });

    it('should reject forms with empty fields array', () => {
      const emptyForm = {
        id: '1',
        title: 'Empty Form-template',
        fields: []
      };
      
      expect(templateManager.validateTemplateStructure(emptyForm)).toBe(false);
    });

    it('should reject forms with invalid field structure', () => {
      const invalidFieldForm = {
        id: '1',
        title: 'Invalid Field Form-template',
        fields: [
          { id: '1' }, // Missing type and label
          { type: 'text', label: 'Name' } // Missing id
        ]
      };
      
      expect(templateManager.validateTemplateStructure(invalidFieldForm)).toBe(false);
    });

    it('should handle null or undefined forms', () => {
      expect(templateManager.validateTemplateStructure(null)).toBe(false);
      expect(templateManager.validateTemplateStructure(undefined)).toBe(false);
    });
  });

  describe('listTemplates', () => {
    const mockApiCall = jest.fn();

    beforeEach(() => {
      templateManager = new TemplateManager(mockApiCall);
    });

    it('should filter and return only template forms', async () => {
      const mockForms = [
        {
          id: '1',
          title: 'Contact Form-template',
          description: 'Template for contact forms',
          fields: [{ id: '1', type: 'text', label: 'Name' }],
          date_created: '2023-01-01 12:00:00'
        },
        {
          id: '2',
          title: 'Regular Form',
          description: 'Not a template',
          fields: [{ id: '1', type: 'text', label: 'Name' }],
          date_created: '2023-01-02 12:00:00'
        },
        {
          id: '3',
          title: 'Registration Form-template',
          description: 'Template for registration',
          fields: [
            { id: '1', type: 'text', label: 'Name' },
            { id: '2', type: 'email', label: 'Email' }
          ],
          date_created: '2023-01-03 12:00:00'
        }
      ];

      mockApiCall.mockResolvedValueOnce(mockForms);

      const result = await templateManager.listTemplates();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '1',
        name: 'Contact Form-template',
        description: 'Template for contact forms',
        field_count: 1,
        created_date: '2023-01-01 12:00:00'
      });
      expect(result[1]).toEqual({
        id: '3',
        name: 'Registration Form-template',
        description: 'Template for registration',
        field_count: 2,
        created_date: '2023-01-03 12:00:00'
      });
    });

    it('should handle empty forms list', async () => {
      mockApiCall.mockResolvedValueOnce([]);

      const result = await templateManager.listTemplates();

      expect(result).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockApiCall.mockRejectedValueOnce(new Error('API Error'));

      await expect(templateManager.listTemplates()).rejects.toThrow('API Error');
    });

    it('should filter out invalid template structures', async () => {
      const mockForms = [
        {
          id: '1',
          title: 'Valid Template-template',
          description: 'Valid template',
          fields: [{ id: '1', type: 'text', label: 'Name' }],
          date_created: '2023-01-01 12:00:00'
        },
        {
          id: '2',
          title: 'Invalid Template-template',
          description: 'Invalid template with no fields',
          fields: [],
          date_created: '2023-01-02 12:00:00'
        }
      ];

      mockApiCall.mockResolvedValueOnce(mockForms);

      const result = await templateManager.listTemplates();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should handle missing optional fields', async () => {
      const mockForms = [
        {
          id: '1',
          title: 'Minimal Template-template',
          fields: [{ id: '1', type: 'text', label: 'Name' }],
          date_created: '2023-01-01 12:00:00'
        }
      ];

      mockApiCall.mockResolvedValueOnce(mockForms);

      const result = await templateManager.listTemplates();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: '1',
        name: 'Minimal Template-template',
        description: '',
        field_count: 1,
        created_date: '2023-01-01 12:00:00'
      });
    });
  });
});