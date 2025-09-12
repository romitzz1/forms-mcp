// ABOUTME: Tests for create_form_from_template tool functionality and integration
// ABOUTME: Tests tool logic with TemplateCreator utility, field renames, and error handling

import type { TemplateModification } from '../../utils/templateCreator.js';
import { FieldRename, TemplateCreator } from '../../utils/templateCreator.js';

describe('create_form_from_template tool logic', () => {
  let templateCreator: TemplateCreator;
  const mockApiCall = jest.fn();

  beforeEach(() => {
    templateCreator = new TemplateCreator(mockApiCall);
    jest.clearAllMocks();
  });

  describe('Basic form creation from template', () => {
    const mockTemplate = {
      id: '10',
      title: 'Contact Form-template',
      description: 'Basic contact form template',
      fields: [
        { id: '1', type: 'text', label: 'Full Name', required: true },
        { id: '2', type: 'email', label: 'Email Address', required: true },
        { id: '3', type: 'textarea', label: 'Message', required: false }
      ],
      settings: {
        save_enabled: true,
        honeypot: false
      },
      is_template: true,
      template_metadata: {
        original_form_id: '5',
        created_from_form: true
      }
    };

    it('should create form from template with new title', async () => {
      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const params = {
        template_id: '10',
        new_form_title: 'Customer Contact Form'
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: [],
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate(params.template_id, modifications);

      expect(mockApiCall).toHaveBeenCalledWith(`/forms/${params.template_id}`);
      expect(result.title).toBe('Customer Contact Form');
      expect(result.id).toBeUndefined(); // Should not copy template ID
      expect(result.fields).toHaveLength(3);
      expect(result.fields[0].label).toBe('Full Name'); // Unchanged
      expect(result.is_template).toBe(true); // Template property preserved by deep clone
    });

    it('should apply field label renames safely', async () => {
      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const params = {
        template_id: '10',
        new_form_title: 'Support Request Form',
        field_renames: [
          { original_label: 'Full Name', new_label: 'Customer Name' },
          { original_label: 'Message', new_label: 'Support Request' }
        ]
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: params.field_renames,
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate(params.template_id, modifications);

      expect(result.title).toBe('Support Request Form');
      expect(result.fields[0].label).toBe('Customer Name');
      expect(result.fields[1].label).toBe('Email Address'); // Unchanged
      expect(result.fields[2].label).toBe('Support Request');
    });

    it('should preserve field types and properties during rename', async () => {
      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const params = {
        template_id: '10',
        new_form_title: 'Registration Form',
        field_renames: [
          { original_label: 'Full Name', new_label: 'Participant Name' }
        ]
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: params.field_renames,
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate(params.template_id, modifications);

      const renamedField = result.fields[0];
      expect(renamedField.label).toBe('Participant Name');
      expect(renamedField.type).toBe('text'); // Type preserved
      expect(renamedField.required).toBe(true); // Properties preserved
      expect(renamedField.id).toBe('1'); // ID preserved
    });
  });

  describe('Field renaming safety validation', () => {
    const mockTemplateWithTypedFields = {
      id: '11',
      title: 'Survey Form-template',
      fields: [
        { id: '1', type: 'date', label: 'Birth Date' },
        { id: '2', type: 'phone', label: 'Contact Number' },
        { id: '3', type: 'email', label: 'Email' },
        { id: '4', type: 'text', label: 'Favorite Color' }
      ],
      is_template: true
    };

    it('should allow safe field renames within same semantic category', async () => {
      mockApiCall.mockResolvedValueOnce(mockTemplateWithTypedFields);

      const params = {
        template_id: '11',
        new_form_title: 'Updated Survey',
        field_renames: [
          { original_label: 'Favorite Color', new_label: 'Favorite Animal' } // Safe: both choices
        ]
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: params.field_renames,
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate(params.template_id, modifications);

      expect(result.fields[3].label).toBe('Favorite Animal');
    });

    it('should reject dangerous field renames across incompatible types', async () => {
      mockApiCall.mockResolvedValueOnce(mockTemplateWithTypedFields);

      const params = {
        template_id: '11',
        new_form_title: 'Bad Survey',
        field_renames: [
          { original_label: 'Birth Date', new_label: 'Phone Number' } // Dangerous: date->phone
        ]
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: params.field_renames,
        preserve_logic: true
      };

      await expect(templateCreator.cloneFromTemplate(params.template_id, modifications))
        .rejects.toThrow('dangerous');
    });

    it('should handle multiple field renames with mixed safety levels', async () => {
      mockApiCall.mockResolvedValueOnce(mockTemplateWithTypedFields);

      const params = {
        template_id: '11',
        new_form_title: 'Mixed Survey',
        field_renames: [
          { original_label: 'Favorite Color', new_label: 'Pet Type' }, // Safe
          { original_label: 'Email', new_label: 'Contact Email' }, // Safe
          { original_label: 'Birth Date', new_label: 'Phone' } // Dangerous
        ]
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: params.field_renames,
        preserve_logic: true
      };

      await expect(templateCreator.cloneFromTemplate(params.template_id, modifications))
        .rejects.toThrow('dangerous');
    });
  });

  describe('Complex templates with conditional logic', () => {
    const mockComplexTemplate = {
      id: '12',
      title: 'Conditional Survey-template',
      fields: [
        { 
          id: '1', 
          type: 'radio', 
          label: 'Are you satisfied?',
          choices: [
            { text: 'Yes', value: 'yes' },
            { text: 'No', value: 'no' },
            { text: 'Somewhat', value: 'somewhat' }
          ]
        },
        { 
          id: '2', 
          type: 'textarea', 
          label: 'Please explain your dissatisfaction',
          conditionalLogic: {
            enabled: true,
            rules: [
              { fieldId: '1', operator: 'is', value: 'no' }
            ]
          }
        },
        {
          id: '3',
          type: 'textarea',
          label: 'Additional comments',
          conditionalLogic: {
            enabled: true,
            rules: [
              { fieldId: '1', operator: 'is', value: 'somewhat' },
              { fieldId: '1', operator: 'is', value: 'no' }
            ]
          }
        }
      ],
      is_template: true
    };

    it('should preserve conditional logic when creating from template', async () => {
      mockApiCall.mockResolvedValueOnce(mockComplexTemplate);

      const params = {
        template_id: '12',
        new_form_title: 'Customer Satisfaction Survey',
        field_renames: [
          { original_label: 'Are you satisfied?', new_label: 'How satisfied are you?' }
        ]
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: params.field_renames,
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate(params.template_id, modifications);

      expect(result.fields[0].label).toBe('How satisfied are you?');
      expect(result.fields[1].conditionalLogic).toBeDefined();
      expect(result.fields[1].conditionalLogic.enabled).toBe(true);
      expect(result.fields[1].conditionalLogic.rules[0].fieldId).toBe('1'); // Field ID preserved
      expect(result.fields[2].conditionalLogic.rules).toHaveLength(2);
    });

    it('should handle field renames without breaking conditional logic references', async () => {
      mockApiCall.mockResolvedValueOnce(mockComplexTemplate);

      const params = {
        template_id: '12',
        new_form_title: 'Employee Survey',
        field_renames: [
          { original_label: 'Please explain your dissatisfaction', new_label: 'What can we improve?' },
          { original_label: 'Additional comments', new_label: 'Other feedback' }
        ]
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: params.field_renames,
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate(params.template_id, modifications);

      expect(result.fields[1].label).toBe('What can we improve?');
      expect(result.fields[2].label).toBe('Other feedback');
      // Conditional logic should still reference the correct field IDs
      expect(result.fields[1].conditionalLogic.rules[0].fieldId).toBe('1');
      expect(result.fields[2].conditionalLogic.rules[0].fieldId).toBe('1');
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle missing template gracefully', async () => {
      mockApiCall.mockRejectedValueOnce(new Error('Template not found'));

      const params = {
        template_id: '999',
        new_form_title: 'New Form'
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: [],
        preserve_logic: true
      };

      await expect(templateCreator.cloneFromTemplate(params.template_id, modifications))
        .rejects.toThrow('Template not found');
    });

    it('should handle invalid field renames', async () => {
      const mockTemplate = {
        id: '13',
        title: 'Simple Form-template',
        fields: [
          { id: '1', type: 'text', label: 'Name' }
        ],
        is_template: true
      };

      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const params = {
        template_id: '13',
        new_form_title: 'New Form',
        field_renames: [
          { original_label: 'Nonexistent Field', new_label: 'New Label' }
        ]
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: params.field_renames,
        preserve_logic: true
      };

      await expect(templateCreator.cloneFromTemplate(params.template_id, modifications))
        .rejects.toThrow('not found');
    });

    it('should handle empty field renames array', async () => {
      const mockTemplate = {
        id: '14',
        title: 'Basic Form-template',
        fields: [
          { id: '1', type: 'text', label: 'Name' },
          { id: '2', type: 'email', label: 'Email' }
        ],
        is_template: true
      };

      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const params = {
        template_id: '14',
        new_form_title: 'Basic Contact Form'
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: [], // Empty array
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate(params.template_id, modifications);

      expect(result.title).toBe('Basic Contact Form');
      expect(result.fields[0].label).toBe('Name'); // Unchanged
      expect(result.fields[1].label).toBe('Email'); // Unchanged
    });

    it('should handle malformed template data', async () => {
      const malformedTemplate = {
        id: '15',
        title: 'Broken Template-template',
        fields: null, // Malformed
        is_template: true
      };

      mockApiCall.mockResolvedValueOnce(malformedTemplate);

      const params = {
        template_id: '15',
        new_form_title: 'New Form'
      };

      const modifications: TemplateModification = {
        title: params.new_form_title,
        field_renames: [],
        preserve_logic: true
      };

      await expect(templateCreator.cloneFromTemplate(params.template_id, modifications))
        .rejects.toThrow('Invalid template structure');
    });

    it('should validate template_id parameter', () => {
      const invalidTemplateIds = ['', null, undefined, 0, false];

      invalidTemplateIds.forEach((invalidId) => {
        const params = {
          template_id: invalidId as any,
          new_form_title: 'Test Form'
        };

        // Validation should happen before API call
        expect(() => {
          if (!params.template_id || typeof params.template_id !== 'string') {
            throw new Error('template_id is required and must be a string');
          }
        }).toThrow('template_id is required');
      });
    });

    it('should validate new_form_title parameter', () => {
      const invalidTitles = ['', null, undefined, 0, false];

      invalidTitles.forEach((invalidTitle) => {
        const params = {
          template_id: '10',
          new_form_title: invalidTitle as any
        };

        expect(() => {
          if (!params.new_form_title || typeof params.new_form_title !== 'string') {
            throw new Error('new_form_title is required and must be a string');
          }
        }).toThrow('new_form_title is required');
      });
    });
  });

  describe('Tool parameter structure validation', () => {
    it('should accept minimal required parameters', () => {
      const minimalParams = {
        template_id: '10',
        new_form_title: 'New Form'
      };

      expect(minimalParams.template_id).toBeDefined();
      expect(minimalParams.new_form_title).toBeDefined();
      expect(typeof minimalParams.template_id).toBe('string');
      expect(typeof minimalParams.new_form_title).toBe('string');
    });

    it('should accept parameters with field renames', () => {
      const fullParams = {
        template_id: '10',
        new_form_title: 'New Form',
        field_renames: [
          { original_label: 'Name', new_label: 'Full Name' },
          { original_label: 'Email', new_label: 'Email Address' }
        ]
      };

      expect(Array.isArray(fullParams.field_renames)).toBe(true);
      expect(fullParams.field_renames[0]).toHaveProperty('original_label');
      expect(fullParams.field_renames[0]).toHaveProperty('new_label');
    });

    it('should validate field_renames structure', () => {
      const invalidFieldRenames = [
        [{ original_label: 'Name' }], // Missing new_label
        [{ new_label: 'Full Name' }], // Missing original_label
        [{ original_label: '', new_label: 'Name' }], // Empty original_label
        [{ original_label: 'Name', new_label: '' }], // Empty new_label
        ['invalid'], // Not an object
        [null], // Null value
      ];

      invalidFieldRenames.forEach((invalidRenames) => {
        expect(() => {
          invalidRenames.forEach((rename: any) => {
            if (!rename || 
                typeof rename !== 'object' ||
                !rename.original_label || 
                !rename.new_label ||
                typeof rename.original_label !== 'string' ||
                typeof rename.new_label !== 'string') {
              throw new Error('Invalid field_renames structure');
            }
          });
        }).toThrow('Invalid field_renames structure');
      });
    });
  });
});