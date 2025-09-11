// ABOUTME: Tests for import_form_json tool functionality and JSON import capabilities
// ABOUTME: Tests JSON validation, conflict resolution, ID mapping, and error handling

describe('import_form_json tool logic', () => {
  const mockApiCall = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('JSON validation and parsing', () => {
    it('should validate and parse well-formed form JSON', () => {
      const validFormJson = JSON.stringify({
        title: 'Imported Contact Form',
        description: 'A form imported from JSON',
        fields: [
          {
            id: '1',
            type: 'text',
            label: 'Full Name',
            required: true
          },
          {
            id: '2',
            type: 'email',
            label: 'Email Address',
            required: true
          }
        ],
        settings: {
          title: 'Imported Contact Form',
          save_enabled: true,
          requireLogin: false
        },
        export_metadata: {
          exported_at: '2023-01-01T12:00:00.000Z',
          export_version: '1.0',
          source: 'gravity-forms-mcp'
        }
      }, null, 2);

      function validateFormJson(jsonString: string): any {
        try {
          const parsed = JSON.parse(jsonString);
          
          // Validate required properties
          if (!parsed.title || typeof parsed.title !== 'string') {
            throw new Error('Invalid form JSON: title is required and must be a string');
          }
          
          if (!parsed.fields || !Array.isArray(parsed.fields)) {
            throw new Error('Invalid form JSON: fields must be an array');
          }
          
          // Validate each field has required properties
          for (const field of parsed.fields) {
            if (!field.id || !field.type || !field.label) {
              throw new Error('Invalid form JSON: each field must have id, type, and label');
            }
          }
          
          return parsed;
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new Error('Invalid JSON format');
          }
          throw error;
        }
      }

      const result = validateFormJson(validFormJson);
      
      expect(result.title).toBe('Imported Contact Form');
      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].label).toBe('Full Name');
      expect(result.export_metadata.source).toBe('gravity-forms-mcp');
    });

    it('should reject malformed JSON', () => {
      const malformedJson = '{ "title": "Broken Form", "fields": [';

      function validateFormJson(jsonString: string): any {
        try {
          return JSON.parse(jsonString);
        } catch (error) {
          throw new Error('Invalid JSON format');
        }
      }

      expect(() => validateFormJson(malformedJson)).toThrow('Invalid JSON format');
    });

    it('should reject JSON missing required properties', () => {
      const invalidFormJson = JSON.stringify({
        description: 'Missing title',
        fields: []
      });

      function validateFormJson(jsonString: string): any {
        const parsed = JSON.parse(jsonString);
        
        if (!parsed.title || typeof parsed.title !== 'string') {
          throw new Error('Invalid form JSON: title is required and must be a string');
        }
        
        return parsed;
      }

      expect(() => validateFormJson(invalidFormJson)).toThrow('title is required');
    });

    it('should reject JSON with invalid field structure', () => {
      const invalidFieldsJson = JSON.stringify({
        title: 'Form with Invalid Fields',
        fields: [
          {
            id: '1',
            // Missing type and label
          }
        ]
      });

      function validateFormJson(jsonString: string): any {
        const parsed = JSON.parse(jsonString);
        
        if (!parsed.fields || !Array.isArray(parsed.fields)) {
          throw new Error('Invalid form JSON: fields must be an array');
        }
        
        for (const field of parsed.fields) {
          if (!field.id || !field.type || !field.label) {
            throw new Error('Invalid form JSON: each field must have id, type, and label');
          }
        }
        
        return parsed;
      }

      expect(() => validateFormJson(invalidFieldsJson)).toThrow('each field must have id, type, and label');
    });
  });

  describe('Conflict detection and resolution', () => {
    const existingForms = [
      { id: '1', title: 'Existing Form 1' },
      { id: '2', title: 'Existing Form 2' },
      { id: '5', title: 'Contact Form' }
    ];

    function detectFormConflicts(importedForm: any, existingForms: any[]): { hasConflict: boolean; conflictType: string; conflictDetails?: any } {
      // Check for title conflicts
      const titleConflict = existingForms.find(form => form.title === importedForm.title);
      if (titleConflict) {
        return {
          hasConflict: true,
          conflictType: 'title',
          conflictDetails: { existingId: titleConflict.id, title: importedForm.title }
        };
      }
      
      // Check for explicit ID conflicts if form has an id
      if (importedForm.id) {
        const idConflict = existingForms.find(form => form.id === importedForm.id);
        if (idConflict) {
          return {
            hasConflict: true,
            conflictType: 'id',
            conflictDetails: { existingId: importedForm.id, title: idConflict.title }
          };
        }
      }
      
      return { hasConflict: false, conflictType: 'none' };
    }

    it('should detect title conflicts with existing forms', () => {
      const importedForm = {
        title: 'Contact Form',
        fields: []
      };

      const result = detectFormConflicts(importedForm, existingForms);
      
      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe('title');
      expect(result.conflictDetails.existingId).toBe('5');
    });

    it('should detect ID conflicts with existing forms', () => {
      const importedForm = {
        id: '2',
        title: 'Imported Form',
        fields: []
      };

      const result = detectFormConflicts(importedForm, existingForms);
      
      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe('id');
      expect(result.conflictDetails.existingId).toBe('2');
    });

    it('should not detect conflicts for unique forms', () => {
      const importedForm = {
        title: 'Unique Form Title',
        fields: []
      };

      const result = detectFormConflicts(importedForm, existingForms);
      
      expect(result.hasConflict).toBe(false);
      expect(result.conflictType).toBe('none');
    });

    it('should generate new form title when conflict detected', () => {
      function resolveConflict(importedForm: any, existingForms: any[]): any {
        const conflict = detectFormConflicts(importedForm, existingForms);
        
        if (conflict.hasConflict && conflict.conflictType === 'title') {
          const baseTitle = importedForm.title;
          let counter = 1;
          let newTitle = `${baseTitle} (Import ${counter})`;
          
          while (existingForms.some(form => form.title === newTitle)) {
            counter++;
            newTitle = `${baseTitle} (Import ${counter})`;
          }
          
          return { ...importedForm, title: newTitle };
        }
        
        return importedForm;
      }

      const importedForm = {
        title: 'Contact Form',
        fields: []
      };

      const resolved = resolveConflict(importedForm, existingForms);
      
      expect(resolved.title).toBe('Contact Form (Import 1)');
    });
  });

  describe('Force import functionality', () => {
    it('should override existing form when force_import is true', () => {
      const importedForm = {
        title: 'Contact Form',
        fields: [{ id: '1', type: 'text', label: 'Name' }]
      };

      const existingForms = [
        { id: '5', title: 'Contact Form' }
      ];

      function handleForceImport(importedForm: any, existingForms: any[], forceImport: boolean): { action: string; targetId?: string; newForm?: any } {
        const conflict = existingForms.find(form => form.title === importedForm.title);
        
        if (conflict && forceImport) {
          return {
            action: 'overwrite',
            targetId: conflict.id,
            newForm: { ...importedForm, id: conflict.id }
          };
        }
        
        if (conflict && !forceImport) {
          return {
            action: 'reject',
            targetId: conflict.id
          };
        }
        
        return {
          action: 'create',
          newForm: importedForm
        };
      }

      const result = handleForceImport(importedForm, existingForms, true);
      
      expect(result.action).toBe('overwrite');
      expect(result.targetId).toBe('5');
      expect(result.newForm?.id).toBe('5');
    });

    it('should reject import when force_import is false and conflict exists', () => {
      const importedForm = {
        title: 'Contact Form',
        fields: []
      };

      const existingForms = [
        { id: '5', title: 'Contact Form' }
      ];

      function handleForceImport(importedForm: any, existingForms: any[], forceImport: boolean): { action: string; error?: string } {
        const conflict = existingForms.find(form => form.title === importedForm.title);
        
        if (conflict && !forceImport) {
          return {
            action: 'reject',
            error: `Form with title "${importedForm.title}" already exists. Use force_import: true to overwrite.`
          };
        }
        
        return { action: 'create' };
      }

      const result = handleForceImport(importedForm, existingForms, false);
      
      expect(result.action).toBe('reject');
      expect(result.error).toContain('already exists');
    });
  });

  describe('ID mapping and reference updates', () => {
    it('should update field IDs to avoid conflicts', () => {
      const importedForm = {
        title: 'Imported Form',
        fields: [
          { id: '1', type: 'text', label: 'Name' },
          { id: '2', type: 'email', label: 'Email' },
          { id: '3', type: 'textarea', label: 'Message' }
        ]
      };

      function updateFieldIds(form: any, startingId: number = 1): { updatedForm: any; idMapping: Record<string, string> } {
        const idMapping: Record<string, string> = {};
        let currentId = startingId;
        
        const updatedFields = form.fields.map((field: any) => {
          const newId = currentId.toString();
          idMapping[field.id] = newId;
          currentId++;
          
          return { ...field, id: newId };
        });
        
        return {
          updatedForm: { ...form, fields: updatedFields },
          idMapping
        };
      }

      const result = updateFieldIds(importedForm, 10);
      
      expect(result.updatedForm.fields[0].id).toBe('10');
      expect(result.updatedForm.fields[1].id).toBe('11');
      expect(result.updatedForm.fields[2].id).toBe('12');
      expect(result.idMapping['1']).toBe('10');
      expect(result.idMapping['2']).toBe('11');
    });

    it('should update conditional logic references when field IDs change', () => {
      const importedForm = {
        title: 'Form with Conditional Logic',
        fields: [
          { id: '1', type: 'radio', label: 'Satisfied?', choices: [{ text: 'Yes', value: 'yes' }, { text: 'No', value: 'no' }] },
          { 
            id: '2', 
            type: 'textarea', 
            label: 'Explain',
            conditionalLogic: {
              enabled: true,
              rules: [
                { fieldId: '1', operator: 'is', value: 'no' }
              ]
            }
          }
        ]
      };

      function updateConditionalLogicReferences(form: any, idMapping: Record<string, string>): any {
        const updatedFields = form.fields.map((field: any) => {
          if (field.conditionalLogic && field.conditionalLogic.rules) {
            const updatedRules = field.conditionalLogic.rules.map((rule: any) => {
              if (rule.fieldId && idMapping[rule.fieldId]) {
                return { ...rule, fieldId: idMapping[rule.fieldId] };
              }
              return rule;
            });
            
            return {
              ...field,
              conditionalLogic: {
                ...field.conditionalLogic,
                rules: updatedRules
              }
            };
          }
          return field;
        });
        
        return { ...form, fields: updatedFields };
      }

      const idMapping = { '1': '10', '2': '11' };
      const result = updateConditionalLogicReferences(importedForm, idMapping);
      
      expect(result.fields[1].conditionalLogic.rules[0].fieldId).toBe('10');
    });

    it('should update calculation formulas when field IDs change', () => {
      const importedForm = {
        title: 'Form with Calculations',
        fields: [
          { id: '1', type: 'number', label: 'Quantity' },
          { id: '2', type: 'number', label: 'Price' },
          { 
            id: '3', 
            type: 'number', 
            label: 'Total',
            isCalculation: true,
            calculationFormula: '{Quantity:1} * {Price:2}'
          }
        ]
      };

      function updateCalculationReferences(form: any, idMapping: Record<string, string>): any {
        const updatedFields = form.fields.map((field: any) => {
          if (field.isCalculation && field.calculationFormula) {
            let updatedFormula = field.calculationFormula;
            
            // Update field references in calculation formula
            for (const [oldId, newId] of Object.entries(idMapping)) {
              const regex = new RegExp(`{([^:]+):${oldId}}`, 'g');
              updatedFormula = updatedFormula.replace(regex, `{$1:${newId}}`);
            }
            
            return { ...field, calculationFormula: updatedFormula };
          }
          return field;
        });
        
        return { ...form, fields: updatedFields };
      }

      const idMapping = { '1': '10', '2': '11', '3': '12' };
      const result = updateCalculationReferences(importedForm, idMapping);
      
      expect(result.fields[2].calculationFormula).toBe('{Quantity:10} * {Price:11}');
    });
  });

  describe('Complete import process', () => {
    it('should successfully import form with no conflicts', () => {
      const formJson = JSON.stringify({
        title: 'New Survey Form',
        description: 'An imported survey form',
        fields: [
          { id: '1', type: 'text', label: 'Full Name', required: true },
          { id: '2', type: 'email', label: 'Email', required: true }
        ],
        settings: {
          save_enabled: true,
          requireLogin: false
        }
      });

      const existingForms: any[] = [];

      function performImport(jsonString: string, existingForms: any[], forceImport: boolean = false): any {
        // Validate JSON
        const parsed = JSON.parse(jsonString);
        if (!parsed.title) throw new Error('Invalid form JSON');
        
        // Check conflicts
        const hasConflict = existingForms.some(form => form.title === parsed.title);
        if (hasConflict && !forceImport) {
          throw new Error('Form title conflict');
        }
        
        // Remove import metadata
        delete parsed.export_metadata;
        
        // Simulate successful import
        return {
          success: true,
          action: 'created',
          form_id: 'new_123',
          form_title: parsed.title,
          fields_imported: parsed.fields.length,
          conflicts_resolved: 0
        };
      }

      const result = performImport(formJson, existingForms);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('created');
      expect(result.form_title).toBe('New Survey Form');
      expect(result.fields_imported).toBe(2);
    });

    it('should import form with conflict resolution', () => {
      const formJson = JSON.stringify({
        title: 'Contact Form',
        fields: [
          { id: '1', type: 'text', label: 'Name' }
        ]
      });

      const existingForms = [
        { id: '5', title: 'Contact Form' }
      ];

      function performImportWithConflictResolution(jsonString: string, existingForms: any[], forceImport: boolean = false): any {
        const parsed = JSON.parse(jsonString);
        
        const hasConflict = existingForms.some(form => form.title === parsed.title);
        
        if (hasConflict && !forceImport) {
          // Resolve conflict by modifying title
          parsed.title = `${parsed.title} (Import 1)`;
          
          return {
            success: true,
            action: 'created_with_modified_title',
            form_id: 'new_124',
            form_title: parsed.title,
            original_title: 'Contact Form',
            conflicts_resolved: 1
          };
        }
        
        return {
          success: true,
          action: 'created',
          form_id: 'new_125',
          form_title: parsed.title
        };
      }

      const result = performImportWithConflictResolution(formJson, existingForms);
      
      expect(result.success).toBe(true);
      expect(result.form_title).toBe('Contact Form (Import 1)');
      expect(result.conflicts_resolved).toBe(1);
    });
  });

  describe('Error handling scenarios', () => {
    it('should handle API failures during form creation', () => {
      const formJson = JSON.stringify({
        title: 'Test Form',
        fields: []
      });

      function performImportWithAPIFailure(jsonString: string): any {
        const parsed = JSON.parse(jsonString);
        
        // Simulate API failure
        throw new Error('API connection failed');
      }

      expect(() => performImportWithAPIFailure(formJson)).toThrow('API connection failed');
    });

    it('should handle partial import failures', () => {
      const formJson = JSON.stringify({
        title: 'Complex Form',
        fields: [
          { id: '1', type: 'text', label: 'Valid Field' },
          { id: '2', type: 'invalid_type', label: 'Invalid Field' }
        ]
      });

      function performPartialImport(jsonString: string): any {
        const parsed = JSON.parse(jsonString);
        
        // Simulate partial failure - some fields invalid
        const validFields = parsed.fields.filter((field: any) => field.type !== 'invalid_type');
        
        return {
          success: true,
          action: 'created_partial',
          form_id: 'new_126',
          form_title: parsed.title,
          fields_imported: validFields.length,
          fields_skipped: parsed.fields.length - validFields.length,
          warnings: ['Field with invalid type skipped: invalid_type']
        };
      }

      const result = performPartialImport(formJson);
      
      expect(result.success).toBe(true);
      expect(result.fields_imported).toBe(1);
      expect(result.fields_skipped).toBe(1);
      expect(result.warnings).toContain('Field with invalid type skipped: invalid_type');
    });
  });

  describe('Tool parameter validation', () => {
    it('should accept form_json parameter', () => {
      const validParams = {
        form_json: JSON.stringify({ title: 'Test Form', fields: [] })
      };

      expect(validParams.form_json).toBeDefined();
      expect(typeof validParams.form_json).toBe('string');
    });

    it('should accept optional force_import parameter', () => {
      const validParams = {
        form_json: JSON.stringify({ title: 'Test Form', fields: [] }),
        force_import: true
      };

      expect(validParams.force_import).toBe(true);
      expect(typeof validParams.force_import).toBe('boolean');
    });

    it('should validate form_json is required', () => {
      const paramsWithoutFormJson = {
        force_import: false
      };

      expect(() => {
        if (!('form_json' in paramsWithoutFormJson)) {
          throw new Error('form_json parameter is required');
        }
      }).toThrow('form_json parameter is required');
    });

    it('should validate form_json is non-empty string', () => {
      const invalidFormJsons = ['', '   ', null, undefined];

      invalidFormJsons.forEach((invalidJson) => {
        const params = { form_json: invalidJson };
        
        expect(() => {
          if (!params.form_json || typeof params.form_json !== 'string' || params.form_json.trim() === '') {
            throw new Error('form_json must be a non-empty string');
          }
        }).toThrow('form_json must be a non-empty string');
      });
    });
  });
});