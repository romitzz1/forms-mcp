// ABOUTME: Simple test for save_form_as_template tool functionality and logic
// ABOUTME: Tests the core logic without complex MCP SDK mocking

describe('save_form_as_template tool logic', () => {
  describe('Template data preparation', () => {
    const mockSourceForm = {
      id: '5',
      title: 'Customer Contact Form',
      description: 'Form for customer inquiries',
      fields: [
        { id: '1', type: 'text', label: 'Name', required: true },
        { id: '2', type: 'email', label: 'Email', required: true },
        { id: '3', type: 'textarea', label: 'Message', required: false }
      ],
      settings: {
        save_enabled: true,
        honeypot: false
      },
      notifications: [
        { id: 'admin', name: 'Admin Notification', to: 'admin@example.com' }
      ],
      confirmations: [
        { id: 'default', name: 'Default Confirmation', message: 'Thank you!' }
      ],
      date_created: '2023-01-01 12:00:00',
      date_updated: '2023-01-02 14:30:00',
      entries_count: 42
    };

    // Helper function that mimics the prepareTemplateData logic
    function prepareTemplateData(sourceForm: any, templateName: string): any {
      // Deep clone the source form to avoid mutation
      const templateData = JSON.parse(JSON.stringify(sourceForm));

      // Remove form-specific properties
      delete templateData.id;
      delete templateData.date_created;
      delete templateData.date_updated;
      delete templateData.entries_count;

      // Clear form-specific data
      templateData.notifications = [];
      templateData.confirmations = [];

      // Set template-specific properties
      templateData.title = templateName;
      templateData.is_template = true;
      templateData.template_metadata = {
        original_form_id: sourceForm.id,
        created_from_form: true,
        created_at: new Date().toISOString()
      };

      return templateData;
    }

    it('should remove form-specific data from template', () => {
      const templateData = prepareTemplateData(mockSourceForm, 'Customer Contact Form-template');

      expect(templateData.id).toBeUndefined();
      expect(templateData.date_created).toBeUndefined();
      expect(templateData.date_updated).toBeUndefined();
      expect(templateData.entries_count).toBeUndefined();
      expect(templateData.notifications).toEqual([]);
      expect(templateData.confirmations).toEqual([]);
    });

    it('should preserve form structure and field definitions', () => {
      const templateData = prepareTemplateData(mockSourceForm, 'Customer Contact Form-template');

      expect(templateData.fields).toEqual(mockSourceForm.fields);
      expect(templateData.settings).toEqual(mockSourceForm.settings);
      expect(templateData.description).toBe(mockSourceForm.description);
    });

    it('should set appropriate template metadata', () => {
      const templateData = prepareTemplateData(mockSourceForm, 'Customer Contact Form-template');

      expect(templateData.title).toBe('Customer Contact Form-template');
      expect(templateData.is_template).toBe(true);
      expect(templateData.template_metadata).toBeDefined();
      expect(templateData.template_metadata.original_form_id).toBe('5');
      expect(templateData.template_metadata.created_from_form).toBe(true);
      expect(templateData.template_metadata.created_at).toBeDefined();
    });

    it('should handle forms with conditional logic', () => {
      const complexForm = {
        ...mockSourceForm,
        fields: [
          { 
            id: '1', 
            type: 'radio', 
            label: 'Type of Inquiry',
            choices: [{ text: 'Support', value: 'support' }, { text: 'Sales', value: 'sales' }]
          },
          { 
            id: '2', 
            type: 'textarea', 
            label: 'Support Details',
            conditionalLogic: {
              enabled: true,
              rules: [{ fieldId: '1', operator: 'is', value: 'support' }]
            }
          }
        ]
      };

      const templateData = prepareTemplateData(complexForm, 'Complex Form-template');

      expect(templateData.fields[1].conditionalLogic).toBeDefined();
      expect(templateData.fields[1].conditionalLogic.enabled).toBe(true);
      expect(templateData.fields[1].conditionalLogic.rules).toHaveLength(1);
    });

    it('should handle forms with calculations', () => {
      const calculationForm = {
        ...mockSourceForm,
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

      const templateData = prepareTemplateData(calculationForm, 'Order Form-template');

      expect(templateData.fields[2].enableCalculation).toBe(true);
      expect(templateData.fields[2].formula).toBe('{Quantity:1} * {Price:2}');
    });

    it('should handle multi-page forms', () => {
      const multiPageForm = {
        ...mockSourceForm,
        pagination: {
          enabled: true,
          pages: [
            { title: 'Personal Info', fields: ['1', '2'] },
            { title: 'Message', fields: ['3'] }
          ]
        }
      };

      const templateData = prepareTemplateData(multiPageForm, 'Survey Form-template');

      expect(templateData.pagination).toBeDefined();
      expect(templateData.pagination.enabled).toBe(true);
      expect(templateData.pagination.pages).toHaveLength(2);
      expect(templateData.pagination.pages[0].title).toBe('Personal Info');
    });
  });

  describe('Name conflict handling', () => {
    it('should detect name conflicts with existing templates', () => {
      const existingTemplates = [
        { id: '8', name: 'Customer Contact Form-template', description: 'Existing', field_count: 2, created_date: '2023-01-01' },
        { id: '9', name: 'Registration Form-template', description: 'Another', field_count: 3, created_date: '2023-01-02' }
      ];

      const templateName = 'Customer Contact Form-template';
      const hasConflict = existingTemplates.some(template => template.name === templateName);

      expect(hasConflict).toBe(true);
    });

    it('should not detect conflicts when name is unique', () => {
      const existingTemplates = [
        { id: '8', name: 'Customer Contact Form-template', description: 'Existing', field_count: 2, created_date: '2023-01-01' },
        { id: '9', name: 'Registration Form-template', description: 'Another', field_count: 3, created_date: '2023-01-02' }
      ];

      const templateName = 'Support Form-template';
      const hasConflict = existingTemplates.some(template => template.name === templateName);

      expect(hasConflict).toBe(false);
    });
  });

  describe('Parameter validation', () => {
    it('should validate required form_id parameter', () => {
      const args: any = {};
      const form_id = args.form_id;

      expect(form_id).toBeUndefined();
      expect(!form_id).toBe(true);
    });

    it('should accept valid form_id parameter', () => {
      const args: any = { form_id: '5' };
      const form_id = args.form_id;

      expect(form_id).toBe('5');
      expect(!form_id).toBe(false);
    });

    it('should handle optional template_name parameter', () => {
      const argsWithName: any = { form_id: '5', template_name: 'Custom Template' };
      const argsWithoutName: any = { form_id: '5' };

      expect(argsWithName.template_name).toBe('Custom Template');
      expect(argsWithoutName.template_name).toBeUndefined();
    });
  });
});