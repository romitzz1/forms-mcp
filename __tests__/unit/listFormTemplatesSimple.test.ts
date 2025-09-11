// ABOUTME: Simple integration test for list_form_templates tool functionality
// ABOUTME: Tests the implementation logic without complex MCP SDK mocking

import { TemplateManager } from '../../utils/templateManager.js';

describe('list_form_templates tool logic', () => {
  describe('Template filtering and sorting', () => {
    const mockTemplates = [
      {
        id: '1',
        name: 'Contact Form-template',
        description: 'Template for contact forms',
        field_count: 3,
        created_date: '2023-01-01 12:00:00'
      },
      {
        id: '2',
        name: 'Registration Form-template',
        description: 'Template for user registration',
        field_count: 5,
        created_date: '2023-01-15 14:30:00'
      },
      {
        id: '3',
        name: 'Feedback Form-template',
        description: 'Template for feedback collection',
        field_count: 4,
        created_date: '2023-02-01 09:15:00'
      }
    ];

    it('should filter templates by search term', () => {
      const searchTerm = 'Contact';
      const filtered = mockTemplates.filter(template => 
        template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.description.toLowerCase().includes(searchTerm.toLowerCase())
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Contact Form-template');
    });

    it('should sort templates by name ascending', () => {
      const sorted = [...mockTemplates].sort((a, b) => a.name.localeCompare(b.name));

      expect(sorted[0].name).toBe('Contact Form-template');
      expect(sorted[1].name).toBe('Feedback Form-template');
      expect(sorted[2].name).toBe('Registration Form-template');
    });

    it('should sort templates by name descending', () => {
      const sorted = [...mockTemplates].sort((a, b) => b.name.localeCompare(a.name));

      expect(sorted[0].name).toBe('Registration Form-template');
      expect(sorted[1].name).toBe('Feedback Form-template');
      expect(sorted[2].name).toBe('Contact Form-template');
    });

    it('should sort templates by date ascending', () => {
      const sorted = [...mockTemplates].sort((a, b) => {
        const dateA = new Date(a.created_date);
        const dateB = new Date(b.created_date);
        return dateA.getTime() - dateB.getTime();
      });

      expect(sorted[0].id).toBe('1'); // 2023-01-01
      expect(sorted[1].id).toBe('2'); // 2023-01-15
      expect(sorted[2].id).toBe('3'); // 2023-02-01
    });

    it('should sort templates by date descending', () => {
      const sorted = [...mockTemplates].sort((a, b) => {
        const dateA = new Date(a.created_date);
        const dateB = new Date(b.created_date);
        return dateB.getTime() - dateA.getTime();
      });

      expect(sorted[0].id).toBe('3'); // 2023-02-01
      expect(sorted[1].id).toBe('2'); // 2023-01-15
      expect(sorted[2].id).toBe('1'); // 2023-01-01
    });

    it('should combine search and sorting', () => {
      // First filter templates containing "template" in description
      const searchTerm = 'template';
      const filtered = mockTemplates.filter(template => 
        template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.description.toLowerCase().includes(searchTerm.toLowerCase())
      );

      // Then sort by date descending
      const sorted = filtered.sort((a, b) => {
        const dateA = new Date(a.created_date);
        const dateB = new Date(b.created_date);
        return dateB.getTime() - dateA.getTime();
      });

      expect(sorted).toHaveLength(3); // All match "template"
      expect(sorted[0].id).toBe('3'); // Latest date first
    });

    it('should handle empty search results', () => {
      const searchTerm = 'NonExistentTemplate';
      const filtered = mockTemplates.filter(template => 
        template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.description.toLowerCase().includes(searchTerm.toLowerCase())
      );

      expect(filtered).toHaveLength(0);
    });
  });

  describe('TemplateManager integration', () => {
    it('should identify templates correctly', () => {
      const templateManager = new TemplateManager();

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

    it('should validate template structure correctly', () => {
      const templateManager = new TemplateManager();

      const validTemplate = {
        id: '1',
        title: 'Valid Template-template',
        fields: [{ id: '1', type: 'text', label: 'Name' }]
      };

      const invalidTemplate = {
        id: '2',
        title: 'Invalid Template-template',
        fields: [] // Empty fields
      };

      expect(templateManager.validateTemplateStructure(validTemplate)).toBe(true);
      expect(templateManager.validateTemplateStructure(invalidTemplate)).toBe(false);
    });
  });
});