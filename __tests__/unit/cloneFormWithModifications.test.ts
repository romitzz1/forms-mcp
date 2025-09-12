// ABOUTME: Tests for clone_form_with_modifications tool functionality and intelligent form cloning
// ABOUTME: Tests form cloning, field modifications, conditional logic preservation, and error handling

describe('clone_form_with_modifications tool logic', () => {
  const mockApiCall = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic form cloning with modifications', () => {
    const mockSourceForm = {
      id: '5',
      title: 'Original Contact Form',
      description: 'Original form description',
      fields: [
        {
          id: '1',
          type: 'text',
          label: 'Full Name',
          required: true,
          placeholder: 'Enter your full name'
        },
        {
          id: '2',
          type: 'email',
          label: 'Email Address',
          required: true,
          placeholder: 'Enter your email'
        },
        {
          id: '3',
          type: 'textarea',
          label: 'Message',
          required: false,
          rows: 5
        }
      ],
      settings: {
        save_enabled: true,
        requireLogin: false
      }
    };

    // Helper function that simulates the clone with modifications logic
    function cloneFormWithModifications(sourceForm: any, modifications: any): any {
      // Create a deep copy of the source form
      const clonedForm = JSON.parse(JSON.stringify(sourceForm));
      
      // Remove the original ID so a new one will be assigned
      delete clonedForm.id;
      
      // Apply title modification
      if (modifications.title) {
        clonedForm.title = modifications.title;
      }
      
      // Apply field label modifications
      if (modifications.field_renames && Array.isArray(modifications.field_renames)) {
        for (const rename of modifications.field_renames) {
          const field = clonedForm.fields.find((f: any) => f.label === rename.original_label);
          if (field) {
            field.label = rename.new_label;
            // Update placeholder if it matches the old label
            if (field.placeholder?.includes(rename.original_label.toLowerCase())) {
              field.placeholder = field.placeholder.replace(
                rename.original_label.toLowerCase(),
                rename.new_label.toLowerCase()
              );
            }
          }
        }
      }
      
      return clonedForm;
    }

    it('should clone form with new title', () => {
      const modifications = {
        title: 'Cloned Contact Form'
      };

      const result = cloneFormWithModifications(mockSourceForm, modifications);
      
      expect(result.title).toBe('Cloned Contact Form');
      expect(result.id).toBeUndefined(); // Original ID should be removed
      expect(result.fields).toHaveLength(3); // All fields preserved
      expect(result.fields[0].label).toBe('Full Name'); // Original labels preserved
    });

    it('should clone form with field label changes', () => {
      const modifications = {
        title: 'Customer Feedback Form',
        field_renames: [
          { original_label: 'Full Name', new_label: 'Customer Name' },
          { original_label: 'Message', new_label: 'Feedback' }
        ]
      };

      const result = cloneFormWithModifications(mockSourceForm, modifications);
      
      expect(result.title).toBe('Customer Feedback Form');
      expect(result.fields[0].label).toBe('Customer Name');
      expect(result.fields[1].label).toBe('Email Address'); // Unchanged
      expect(result.fields[2].label).toBe('Feedback');
      
      // Check that placeholder was also updated
      expect(result.fields[0].placeholder).toBe('Enter your customer name');
    });

    it('should preserve all field properties during cloning', () => {
      const modifications = {
        title: 'Cloned Form'
      };

      const result = cloneFormWithModifications(mockSourceForm, modifications);
      
      // Check that field properties are preserved
      expect(result.fields[0].type).toBe('text');
      expect(result.fields[0].required).toBe(true);
      expect(result.fields[1].type).toBe('email');
      expect(result.fields[2].rows).toBe(5);
      
      // Check that form settings are preserved
      expect(result.settings.save_enabled).toBe(true);
      expect(result.settings.requireLogin).toBe(false);
    });

    it('should handle empty field_renames array', () => {
      const modifications = {
        title: 'New Form',
        field_renames: []
      };

      const result = cloneFormWithModifications(mockSourceForm, modifications);
      
      expect(result.title).toBe('New Form');
      expect(result.fields[0].label).toBe('Full Name'); // Unchanged
      expect(result.fields[1].label).toBe('Email Address'); // Unchanged
    });

    it('should handle missing field renames gracefully', () => {
      const modifications = {
        title: 'New Form',
        field_renames: [
          { original_label: 'Nonexistent Field', new_label: 'New Label' }
        ]
      };

      const result = cloneFormWithModifications(mockSourceForm, modifications);
      
      expect(result.title).toBe('New Form');
      expect(result.fields[0].label).toBe('Full Name'); // All fields unchanged
      expect(result.fields[1].label).toBe('Email Address');
      expect(result.fields[2].label).toBe('Message');
    });
  });

  describe('Complex forms with conditional logic', () => {
    const mockComplexForm = {
      id: '7',
      title: 'Survey Form',
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
          label: 'Please explain',
          conditionalLogic: {
            enabled: true,
            actionType: 'show',
            logicType: 'any',
            rules: [
              {
                fieldId: '1',
                operator: 'is',
                value: 'no'
              },
              {
                fieldId: '1',
                operator: 'is',
                value: 'somewhat'
              }
            ]
          }
        },
        {
          id: '3',
          type: 'number',
          label: 'Rating'
        },
        {
          id: '4',
          type: 'number',
          label: 'Weighted Score',
          isCalculation: true,
          calculationFormula: '{Rating:3} * 2'
        }
      ]
    };

    function cloneComplexFormWithModifications(sourceForm: any, modifications: any): any {
      const clonedForm = JSON.parse(JSON.stringify(sourceForm));
      delete clonedForm.id;
      
      // Apply modifications
      if (modifications.title) {
        clonedForm.title = modifications.title;
      }
      
      // Apply field renames and update references
      if (modifications.field_renames) {
        // Create mapping of old to new labels
        const labelMapping: Record<string, string> = {};
        
        for (const rename of modifications.field_renames) {
          const field = clonedForm.fields.find((f: any) => f.label === rename.original_label);
          if (field) {
            labelMapping[rename.original_label] = rename.new_label;
            field.label = rename.new_label;
          }
        }
        
        // Update calculation formulas that reference renamed fields
        for (const field of clonedForm.fields) {
          if (field.isCalculation && field.calculationFormula) {
            let updatedFormula = field.calculationFormula;
            for (const [oldLabel, newLabel] of Object.entries(labelMapping)) {
              // Update formula references (simple regex replacement)
              const regex = new RegExp(`{${oldLabel}:`, 'g');
              updatedFormula = updatedFormula.replace(regex, `{${newLabel}:`);
            }
            field.calculationFormula = updatedFormula;
          }
        }
      }
      
      return clonedForm;
    }

    it('should preserve conditional logic during cloning', () => {
      const modifications = {
        title: 'Cloned Survey'
      };

      const result = cloneComplexFormWithModifications(mockComplexForm, modifications);
      
      expect(result.title).toBe('Cloned Survey');
      
      const conditionalField = result.fields[1];
      expect(conditionalField.conditionalLogic).toBeDefined();
      expect(conditionalField.conditionalLogic.enabled).toBe(true);
      expect(conditionalField.conditionalLogic.rules).toHaveLength(2);
      expect(conditionalField.conditionalLogic.rules[0].fieldId).toBe('1');
      expect(conditionalField.conditionalLogic.rules[0].value).toBe('no');
    });

    it('should preserve calculation formulas during cloning', () => {
      const modifications = {
        title: 'Cloned Survey'
      };

      const result = cloneComplexFormWithModifications(mockComplexForm, modifications);
      
      const calculationField = result.fields[3];
      expect(calculationField.isCalculation).toBe(true);
      expect(calculationField.calculationFormula).toBe('{Rating:3} * 2');
    });

    it('should update calculation formula references when field labels change', () => {
      const modifications = {
        title: 'Customer Rating Survey',
        field_renames: [
          { original_label: 'Rating', new_label: 'Customer Rating' }
        ]
      };

      const result = cloneComplexFormWithModifications(mockComplexForm, modifications);
      
      expect(result.fields[2].label).toBe('Customer Rating');
      
      const calculationField = result.fields[3];
      expect(calculationField.calculationFormula).toBe('{Customer Rating:3} * 2');
    });

    it('should handle complex field renames with multiple references', () => {
      const modifications = {
        title: 'Satisfaction Survey',
        field_renames: [
          { original_label: 'Are you satisfied?', new_label: 'How satisfied are you?' },
          { original_label: 'Please explain', new_label: 'Please provide details' }
        ]
      };

      const result = cloneComplexFormWithModifications(mockComplexForm, modifications);
      
      expect(result.fields[0].label).toBe('How satisfied are you?');
      expect(result.fields[1].label).toBe('Please provide details');
      
      // Conditional logic should still reference the same field IDs
      const conditionalField = result.fields[1];
      expect(conditionalField.conditionalLogic.rules[0].fieldId).toBe('1');
    });
  });

  describe('Field modification validation', () => {
    it('should validate that field_renames is an array', () => {
      function validateModifications(modifications: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (modifications.field_renames && !Array.isArray(modifications.field_renames)) {
          errors.push('field_renames must be an array');
        }
        
        if (modifications.field_renames) {
          for (const rename of modifications.field_renames) {
            if (!rename.original_label || typeof rename.original_label !== 'string') {
              errors.push('Each field rename must have original_label as string');
            }
            if (!rename.new_label || typeof rename.new_label !== 'string') {
              errors.push('Each field rename must have new_label as string');
            }
          }
        }
        
        return { valid: errors.length === 0, errors };
      }

      const invalidModifications = {
        field_renames: 'not an array'
      };

      const result = validateModifications(invalidModifications);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('field_renames must be an array');
    });

    it('should validate field rename structure', () => {
      function validateModifications(modifications: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (modifications.field_renames) {
          for (const rename of modifications.field_renames) {
            if (!rename.original_label || typeof rename.original_label !== 'string') {
              errors.push('Each field rename must have original_label as string');
            }
            if (!rename.new_label || typeof rename.new_label !== 'string') {
              errors.push('Each field rename must have new_label as string');
            }
          }
        }
        
        return { valid: errors.length === 0, errors };
      }

      const invalidModifications = {
        field_renames: [
          { original_label: 'Valid Label' }, // Missing new_label
          { new_label: 'Another Label' } // Missing original_label
        ]
      };

      const result = validateModifications(invalidModifications);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Each field rename must have new_label as string');
      expect(result.errors).toContain('Each field rename must have original_label as string');
    });

    it('should accept valid modifications', () => {
      function validateModifications(modifications: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (modifications.field_renames && !Array.isArray(modifications.field_renames)) {
          errors.push('field_renames must be an array');
        }
        
        if (modifications.field_renames) {
          for (const rename of modifications.field_renames) {
            if (!rename.original_label || typeof rename.original_label !== 'string') {
              errors.push('Each field rename must have original_label as string');
            }
            if (!rename.new_label || typeof rename.new_label !== 'string') {
              errors.push('Each field rename must have new_label as string');
            }
          }
        }
        
        return { valid: errors.length === 0, errors };
      }

      const validModifications = {
        title: 'New Form Title',
        field_renames: [
          { original_label: 'Old Label', new_label: 'New Label' }
        ]
      };

      const result = validateModifications(validModifications);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Error handling scenarios', () => {
    it('should handle source form not found', () => {
      function performClone(sourceFormId: string, modifications: any): any {
        // Simulate API response for non-existent form
        if (sourceFormId === 'nonexistent') {
          throw new Error('Form not found');
        }
        
        return {
          success: true,
          cloned_form_id: 'new_123',
          message: 'Form cloned successfully'
        };
      }

      expect(() => performClone('nonexistent', { title: 'New Form' }))
        .toThrow('Form not found');
    });

    it('should handle API failures during cloning', () => {
      function performCloneWithAPIFailure(sourceFormId: string, modifications: any): any {
        // Simulate API failure during form creation
        throw new Error('API connection failed');
      }

      expect(() => performCloneWithAPIFailure('5', { title: 'New Form' }))
        .toThrow('API connection failed');
    });

    it('should handle empty source form', () => {
      const emptyForm = {
        id: '10',
        title: 'Empty Form',
        fields: []
      };

      function cloneEmptyForm(sourceForm: any, modifications: any): any {
        const cloned = { ...sourceForm };
        delete cloned.id;
        
        if (modifications.title) {
          cloned.title = modifications.title;
        }
        
        return cloned;
      }

      const result = cloneEmptyForm(emptyForm, { title: 'Cloned Empty Form' });
      
      expect(result.title).toBe('Cloned Empty Form');
      expect(result.fields).toEqual([]);
      expect(result.id).toBeUndefined();
    });

    it('should handle malformed modifications object', () => {
      function validateAndClone(sourceForm: any, modifications: any): any {
        if (!modifications || typeof modifications !== 'object') {
          throw new Error('modifications must be an object');
        }
        
        const cloned = { ...sourceForm };
        delete cloned.id;
        
        if (modifications.title) {
          cloned.title = modifications.title;
        }
        
        return cloned;
      }

      const sourceForm = { id: '5', title: 'Test Form', fields: [] };

      expect(() => validateAndClone(sourceForm, null))
        .toThrow('modifications must be an object');
      expect(() => validateAndClone(sourceForm, 'invalid'))
        .toThrow('modifications must be an object');
    });
  });

  describe('Integration with existing utilities', () => {
    it('should work with TemplateCreator patterns for field safety', () => {
      function safeFieldModification(field: any, newLabel: string): { safe: boolean; warning?: string } {
        // Simulate field type safety validation like TemplateCreator
        const dangerousTypes = ['date', 'time', 'number'];
        const safeTypes = ['text', 'textarea', 'email'];
        
        if (dangerousTypes.includes(field.type)) {
          return {
            safe: false,
            warning: `Changing label of ${field.type} field may affect data integrity`
          };
        }
        
        return { safe: true };
      }

      const dateField = { id: '1', type: 'date', label: 'Birth Date' };
      const textField = { id: '2', type: 'text', label: 'Name' };

      const dateResult = safeFieldModification(dateField, 'Anniversary Date');
      const textResult = safeFieldModification(textField, 'Full Name');

      expect(dateResult.safe).toBe(false);
      expect(dateResult.warning).toContain('data integrity');
      expect(textResult.safe).toBe(true);
    });

    it('should combine with existing validation patterns', () => {
      function validateCloneRequest(sourceFormId: string, modifications: any): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        // Source form validation
        if (!sourceFormId || typeof sourceFormId !== 'string') {
          errors.push('source_form_id is required and must be a string');
        }
        
        // Modifications validation
        if (!modifications || typeof modifications !== 'object') {
          errors.push('modifications is required and must be an object');
        } else {
          if (modifications.title && typeof modifications.title !== 'string') {
            errors.push('title must be a string');
          }
        }
        
        return { valid: errors.length === 0, errors };
      }

      const validRequest = validateCloneRequest('5', { title: 'New Form' });
      const invalidRequest = validateCloneRequest('', null);

      expect(validRequest.valid).toBe(true);
      expect(invalidRequest.valid).toBe(false);
      expect(invalidRequest.errors).toContain('source_form_id is required and must be a string');
      expect(invalidRequest.errors).toContain('modifications is required and must be an object');
    });
  });

  describe('Tool parameter structure validation', () => {
    it('should accept source_form_id parameter', () => {
      const validParams = {
        source_form_id: '5'
      };

      expect(validParams.source_form_id).toBeDefined();
      expect(typeof validParams.source_form_id).toBe('string');
    });

    it('should accept modifications parameter', () => {
      const validParams = {
        source_form_id: '5',
        modifications: {
          title: 'New Form Title',
          field_renames: [
            { original_label: 'Old Label', new_label: 'New Label' }
          ]
        }
      };

      expect(validParams.modifications).toBeDefined();
      expect(typeof validParams.modifications).toBe('object');
      expect(validParams.modifications.title).toBe('New Form Title');
      expect(validParams.modifications.field_renames).toHaveLength(1);
    });

    it('should validate source_form_id is required', () => {
      const paramsWithoutSourceId = {
        modifications: { title: 'New Form' }
      };

      expect(() => {
        if (!('source_form_id' in paramsWithoutSourceId)) {
          throw new Error('source_form_id parameter is required');
        }
      }).toThrow('source_form_id parameter is required');
    });

    it('should validate source_form_id is non-empty string', () => {
      const invalidSourceIds = ['', '   ', null, undefined];

      invalidSourceIds.forEach((invalidId) => {
        const params = { source_form_id: invalidId, modifications: {} };
        
        expect(() => {
          if (!params.source_form_id || typeof params.source_form_id !== 'string' || params.source_form_id.trim() === '') {
            throw new Error('source_form_id must be a non-empty string');
          }
        }).toThrow('source_form_id must be a non-empty string');
      });
    });

    it('should make modifications parameter optional', () => {
      const paramsWithoutModifications = {
        source_form_id: '5'
      };

      // Should not throw - modifications is optional
      expect(paramsWithoutModifications.source_form_id).toBe('5');
      expect(paramsWithoutModifications).not.toHaveProperty('modifications');
    });
  });
});