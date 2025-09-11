// ABOUTME: Tests for TemplateCreator class that handles safe form template modifications
// ABOUTME: Covers cloning, field renaming, type safety, and conditional logic preservation

import { TemplateCreator } from '../../utils/templateCreator.js';

describe('TemplateCreator', () => {
  let templateCreator: TemplateCreator;
  const mockApiCall = jest.fn();

  beforeEach(() => {
    templateCreator = new TemplateCreator(mockApiCall);
    jest.clearAllMocks();
  });

  describe('Field type validation', () => {
    it('should identify safe field label renames', () => {
      const mockTemplate = {
        id: '1',
        title: 'Contact Form-template',
        fields: [
          { id: '1', type: 'text', label: 'First Name' },
          { id: '2', type: 'text', label: 'Last Name' },
          { id: '3', type: 'text', label: 'Pet Color' }
        ]
      };

      const safeRenames = [
        { original_label: 'Pet Color', new_label: 'Pet Type' }, // Safe: both text concepts
        { original_label: 'First Name', new_label: 'Given Name' } // Safe: same semantic meaning
      ];

      const result = templateCreator.validateFieldRenames(mockTemplate, safeRenames);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should prevent dangerous field type changes', () => {
      const mockTemplate = {
        id: '1',
        title: 'Form-template',
        fields: [
          { id: '1', type: 'date', label: 'Birthday' },
          { id: '2', type: 'phone', label: 'Phone Number' },
          { id: '3', type: 'email', label: 'Email Address' }
        ]
      };

      const dangerousRenames = [
        { original_label: 'Birthday', new_label: 'Phone Number' }, // Dangerous: date->phone semantics
        { original_label: 'Email Address', new_label: 'Age' } // Dangerous: email->number semantics
      ];

      const result = templateCreator.validateFieldRenames(mockTemplate, dangerousRenames);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous');
    });

    it('should allow safe semantic field changes', () => {
      const mockTemplate = {
        id: '1',
        title: 'Survey-template',
        fields: [
          { id: '1', type: 'text', label: 'Favorite Color' },
          { id: '2', type: 'text', label: 'Pet Name' },
          { id: '3', type: 'textarea', label: 'Comments' }
        ]
      };

      const safeRenames = [
        { original_label: 'Favorite Color', new_label: 'Favorite Animal' }, // Safe: both text concepts
        { original_label: 'Pet Name', new_label: 'Child Name' }, // Safe: both name concepts
        { original_label: 'Comments', new_label: 'Feedback' } // Safe: both text areas
      ];

      const result = templateCreator.validateFieldRenames(mockTemplate, safeRenames);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should warn about potentially risky renames', () => {
      const mockTemplate = {
        id: '1',
        title: 'Form-template',
        fields: [
          { id: '1', type: 'text', label: 'Age' },
          { id: '2', type: 'text', label: 'Name' }
        ]
      };

      const riskyRenames = [
        { original_label: 'Age', new_label: 'Phone' }, // Risky: age->phone might expect different validation
        { original_label: 'Name', new_label: 'Date' } // Risky: name->date semantic mismatch
      ];

      const result = templateCreator.validateFieldRenames(mockTemplate, riskyRenames);

      expect(result.success).toBe(true); // Allowed but with warnings
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle fields not found in template', () => {
      const mockTemplate = {
        id: '1',
        title: 'Form-template',
        fields: [
          { id: '1', type: 'text', label: 'Name' }
        ]
      };

      const invalidRenames = [
        { original_label: 'NonExistent Field', new_label: 'Some Label' }
      ];

      const result = templateCreator.validateFieldRenames(mockTemplate, invalidRenames);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('not found');
    });
  });

  describe('Template cloning', () => {
    it('should clone form structure and update title', async () => {
      const mockTemplate = {
        id: '1',
        title: 'Contact Form-template',
        description: 'Template for contact forms',
        fields: [
          { id: '1', type: 'text', label: 'Name' },
          { id: '2', type: 'email', label: 'Email' }
        ],
        settings: { save_enabled: true }
      };

      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const modifications = {
        title: 'Customer Contact Form',
        field_renames: [
          { original_label: 'Name', new_label: 'Customer Name' }
        ],
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate('1', modifications);

      expect(result.title).toBe('Customer Contact Form');
      expect(result.fields[0].label).toBe('Customer Name');
      expect(result.fields[1].label).toBe('Email'); // Unchanged
      expect(result.id).toBeUndefined(); // Should not copy ID
    });

    it('should preserve conditional logic when requested', async () => {
      const mockTemplate = {
        id: '1',
        title: 'Survey-template',
        fields: [
          { 
            id: '1', 
            type: 'radio', 
            label: 'Are you satisfied?',
            choices: [{ text: 'Yes', value: 'yes' }, { text: 'No', value: 'no' }]
          },
          { 
            id: '2', 
            type: 'textarea', 
            label: 'Please explain',
            conditionalLogic: {
              enabled: true,
              rules: [{ fieldId: '1', operator: 'is', value: 'no' }]
            }
          }
        ]
      };

      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const modifications = {
        title: 'Customer Survey',
        field_renames: [],
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate('1', modifications);

      expect(result.fields[1].conditionalLogic).toBeDefined();
      expect(result.fields[1].conditionalLogic.enabled).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      mockApiCall.mockRejectedValueOnce(new Error('Template not found'));

      const modifications = {
        title: 'New Form',
        field_renames: [],
        preserve_logic: true
      };

      await expect(templateCreator.cloneFromTemplate('999', modifications))
        .rejects.toThrow('Template not found');
    });

    it('should validate modifications before applying', async () => {
      const mockTemplate = {
        id: '1',
        title: 'Form-template',
        fields: [
          { id: '1', type: 'date', label: 'Birthday' }
        ]
      };

      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const dangerousModifications = {
        title: 'New Form',
        field_renames: [
          { original_label: 'Birthday', new_label: 'Phone Number' } // Dangerous
        ],
        preserve_logic: true
      };

      await expect(templateCreator.cloneFromTemplate('1', dangerousModifications))
        .rejects.toThrow('dangerous');
    });
  });

  describe('Field rename application', () => {
    it('should apply field renames correctly', () => {
      const mockForm = {
        title: 'Test Form',
        fields: [
          { id: '1', type: 'text', label: 'First Name' },
          { id: '2', type: 'text', label: 'Last Name' },
          { id: '3', type: 'email', label: 'Email' }
        ]
      };

      const renames = [
        { original_label: 'First Name', new_label: 'Given Name' },
        { original_label: 'Email', new_label: 'Email Address' }
      ];

      const result = templateCreator.applyFieldRenames(mockForm, renames);

      expect(result.fields[0].label).toBe('Given Name');
      expect(result.fields[1].label).toBe('Last Name'); // Unchanged
      expect(result.fields[2].label).toBe('Email Address');
    });

    it('should preserve field IDs and types during rename', () => {
      const mockForm = {
        title: 'Test Form',
        fields: [
          { id: '1', type: 'text', label: 'Name', required: true }
        ]
      };

      const renames = [
        { original_label: 'Name', new_label: 'Full Name' }
      ];

      const result = templateCreator.applyFieldRenames(mockForm, renames);

      expect(result.fields[0].id).toBe('1');
      expect(result.fields[0].type).toBe('text');
      expect(result.fields[0].required).toBe(true);
      expect(result.fields[0].label).toBe('Full Name');
    });

    it('should handle conditional logic field references during rename', () => {
      const mockForm = {
        title: 'Survey Form',
        fields: [
          { id: '1', type: 'radio', label: 'Satisfied?', choices: [] },
          { 
            id: '2', 
            type: 'textarea', 
            label: 'Explain',
            conditionalLogic: {
              enabled: true,
              rules: [{ fieldId: '1', operator: 'is', value: 'no' }]
            }
          }
        ]
      };

      const renames = [
        { original_label: 'Satisfied?', new_label: 'Happy?' }
      ];

      const result = templateCreator.applyFieldRenames(mockForm, renames);

      expect(result.fields[0].label).toBe('Happy?');
      // Conditional logic should still reference the same field ID
      expect(result.fields[1].conditionalLogic.rules[0].fieldId).toBe('1');
    });

    it('should handle empty renames array', () => {
      const mockForm = {
        title: 'Test Form',
        fields: [
          { id: '1', type: 'text', label: 'Name' }
        ]
      };

      const result = templateCreator.applyFieldRenames(mockForm, []);

      expect(result.fields[0].label).toBe('Name'); // Unchanged
    });
  });

  describe('Complex forms with calculations', () => {
    it('should preserve form calculations and formulas', async () => {
      const mockTemplate = {
        id: '1',
        title: 'Order Form-template',
        fields: [
          { id: '1', type: 'number', label: 'Quantity' },
          { id: '2', type: 'number', label: 'Price' },
          { 
            id: '3', 
            type: 'number', 
            label: 'Total',
            enableCalculation: true,
            formula: '{Quantity:1} * {Price:2}'
          }
        ]
      };

      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const modifications = {
        title: 'Product Order Form',
        field_renames: [
          { original_label: 'Quantity', new_label: 'Amount' }
        ],
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate('1', modifications);

      expect(result.fields[2].enableCalculation).toBe(true);
      expect(result.fields[2].formula).toBe('{Quantity:1} * {Price:2}'); // Formula preserved with original field references
    });

    it('should handle complex multi-page forms', async () => {
      const mockTemplate = {
        id: '1',
        title: 'Multi-page Survey-template',
        fields: [
          { id: '1', type: 'text', label: 'Name', pageNumber: 1 },
          { id: '2', type: 'email', label: 'Email', pageNumber: 1 },
          { id: '3', type: 'textarea', label: 'Comments', pageNumber: 2 }
        ],
        pagination: {
          enabled: true,
          pages: [
            { title: 'Personal Info', fields: ['1', '2'] },
            { title: 'Feedback', fields: ['3'] }
          ]
        }
      };

      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const modifications = {
        title: 'Customer Survey',
        field_renames: [
          { original_label: 'Comments', new_label: 'Suggestions' }
        ],
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate('1', modifications);

      expect(result.pagination).toBeDefined();
      expect(result.pagination.enabled).toBe(true);
      expect(result.fields[2].label).toBe('Suggestions');
      expect(result.fields[2].pageNumber).toBe(2);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle malformed template data', async () => {
      const malformedTemplate = {
        id: '1',
        title: 'Bad Template-template',
        fields: null // Malformed
      };

      mockApiCall.mockResolvedValueOnce(malformedTemplate);

      const modifications = {
        title: 'New Form',
        field_renames: [],
        preserve_logic: true
      };

      await expect(templateCreator.cloneFromTemplate('1', modifications))
        .rejects.toThrow('Invalid template structure');
    });

    it('should handle duplicate field labels', () => {
      const mockTemplate = {
        id: '1',
        title: 'Form-template',
        fields: [
          { id: '1', type: 'text', label: 'Name' },
          { id: '2', type: 'text', label: 'Name' } // Duplicate
        ]
      };

      const renames = [
        { original_label: 'Name', new_label: 'Full Name' }
      ];

      const result = templateCreator.validateFieldRenames(mockTemplate, renames);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('duplicate');
    });

    it('should handle empty field renames array', () => {
      const mockTemplate = {
        id: '1',
        title: 'Form-template',
        fields: [
          { id: '1', type: 'text', label: 'Name' }
        ]
      };

      const result = templateCreator.validateFieldRenames(mockTemplate, []);

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should use field type for more accurate semantic categorization', () => {
      const mockTemplate = {
        id: '1',
        title: 'Form-template',
        fields: [
          { id: '1', type: 'date', label: 'Name' }, // date field mislabeled as Name
          { id: '2', type: 'email', label: 'Age' }   // email field mislabeled as Age
        ]
      };

      const dangerousRenames = [
        { original_label: 'Name', new_label: 'Phone Number' }, // date->contact (dangerous)
        { original_label: 'Age', new_label: 'Comments' }       // email->text (dangerous)
      ];

      const result = templateCreator.validateFieldRenames(mockTemplate, dangerousRenames);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('dangerous');
    });

    it('should handle Date objects in form cloning', async () => {
      const mockTemplate = {
        id: '1',
        title: 'Form-template',
        fields: [{ id: '1', type: 'text', label: 'Name' }],
        date_created: new Date('2023-01-01'),
        settings: {
          save_enabled: true,
          created_at: new Date('2023-01-01')
        }
      };

      mockApiCall.mockResolvedValueOnce(mockTemplate);

      const modifications = {
        title: 'New Form',
        field_renames: [],
        preserve_logic: true
      };

      const result = await templateCreator.cloneFromTemplate('1', modifications);

      // Should handle Date objects properly (not convert to strings)
      expect(result.settings.created_at).toBeInstanceOf(Date);
      expect(result.settings.created_at.getTime()).toBe(new Date('2023-01-01').getTime());
    });
  });
});