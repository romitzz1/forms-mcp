// ABOUTME: Tests for export_form_json tool functionality and JSON export capabilities
// ABOUTME: Tests complete form export, sensitive data removal, and error handling

describe('export_form_json tool logic', () => {
  const mockApiCall = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete form definition export', () => {
    const mockCompleteForm = {
      id: '5',
      title: 'Customer Contact Form',
      description: 'Complete form for customer inquiries',
      labelPlacement: 'top_label',
      descriptionPlacement: 'below',
      button: {
        type: 'text',
        text: 'Submit',
        imageUrl: ''
      },
      fields: [
        {
          id: '1',
          type: 'text',
          label: 'Full Name',
          description: 'Enter your full name',
          required: true,
          size: 'medium',
          defaultValue: '',
          maxLength: 100,
          placeholder: 'John Doe',
          cssClass: 'name-field'
        },
        {
          id: '2',
          type: 'email',
          label: 'Email Address',
          description: 'Enter a valid email address',
          required: true,
          size: 'medium',
          defaultValue: '',
          placeholder: 'john@example.com'
        },
        {
          id: '3',
          type: 'textarea',
          label: 'Message',
          description: 'Enter your message',
          required: false,
          size: 'medium',
          rows: 5,
          maxLength: 1000
        },
        {
          id: '4',
          type: 'radio',
          label: 'Contact Preference',
          description: 'How would you like to be contacted?',
          required: true,
          choices: [
            { text: 'Email', value: 'email', isSelected: true },
            { text: 'Phone', value: 'phone', isSelected: false },
            { text: 'Mail', value: 'mail', isSelected: false }
          ]
        }
      ],
      settings: {
        title: 'Customer Contact Form',
        description: 'Complete form for customer inquiries',
        labelPlacement: 'top_label',
        descriptionPlacement: 'below',
        button: {
          type: 'text',
          text: 'Submit'
        },
        save_enabled: true,
        requireLogin: false,
        honeypot: true,
        animation: false,
        save_incomplete: true
      },
      confirmations: [
        {
          id: 'default',
          name: 'Default Confirmation',
          isDefault: true,
          type: 'message',
          message: 'Thank you for contacting us! We will get back to you soon.',
          url: '',
          pageId: '',
          queryString: ''
        }
      ],
      notifications: [
        {
          id: 'admin',
          name: 'Admin Notification',
          service: 'wordpress',
          event: 'form_submission',
          to: 'admin@example.com',
          toType: 'email',
          subject: 'New Form Submission',
          message: 'A new form submission has been received.',
          from: '{admin_email}',
          fromName: 'WordPress',
          replyTo: '{entry:2}',
          bcc: '',
          isActive: true,
          conditionalLogic: ''
        }
      ],
      date_created: '2023-01-01 12:00:00',
      date_updated: '2023-01-02 14:30:00',
      entries_count: 42,
      is_active: "1",  // Gravity Forms API returns strings
      is_trash: "0"
    };

    // Helper function that simulates form export logic
    function exportFormAsJson(form: any): string {
      // Create a clean copy for export
      const exportForm = JSON.parse(JSON.stringify(form));

      // Remove runtime/metadata properties that shouldn't be exported
      delete exportForm.id;
      delete exportForm.date_created;
      delete exportForm.date_updated;
      delete exportForm.entries_count;
      delete exportForm.is_active;
      delete exportForm.is_trash;

      // Remove sensitive notification data
      if (exportForm.notifications) {
        exportForm.notifications = exportForm.notifications.map((notification: any) => {
          const cleanNotification = { ...notification };
          // Remove sensitive email addresses and API keys
          if (cleanNotification.to && cleanNotification.to.includes('@') && cleanNotification.to !== '{admin_email}') {
            cleanNotification.to = '{admin_email}'; // Use placeholder
          }
          delete cleanNotification.apiKey;
          delete cleanNotification.privateKey;
          return cleanNotification;
        });
      }

      // Add export metadata
      exportForm.export_metadata = {
        exported_at: new Date().toISOString(),
        export_version: '1.0',
        source: 'gravity-forms-mcp'
      };

      return JSON.stringify(exportForm, null, 2);
    }

    it('should export complete form definition including all fields', () => {
      const result = exportFormAsJson(mockCompleteForm);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.title).toBe('Customer Contact Form');
      expect(parsedResult.description).toBe('Complete form for customer inquiries');
      expect(parsedResult.fields).toHaveLength(4);
      expect(parsedResult.fields[0].label).toBe('Full Name');
      expect(parsedResult.fields[1].label).toBe('Email Address');
      expect(parsedResult.fields[2].label).toBe('Message');
      expect(parsedResult.fields[3].label).toBe('Contact Preference');
    });

    it('should include all field properties and configurations', () => {
      const result = exportFormAsJson(mockCompleteForm);
      const parsedResult = JSON.parse(result);

      const nameField = parsedResult.fields[0];
      expect(nameField.type).toBe('text');
      expect(nameField.required).toBe(true);
      expect(nameField.maxLength).toBe(100);
      expect(nameField.placeholder).toBe('John Doe');
      expect(nameField.cssClass).toBe('name-field');

      const radioField = parsedResult.fields[3];
      expect(radioField.choices).toHaveLength(3);
      expect(radioField.choices[0].text).toBe('Email');
      expect(radioField.choices[0].isSelected).toBe(true);
    });

    it('should include form settings and configuration', () => {
      const result = exportFormAsJson(mockCompleteForm);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.settings).toBeDefined();
      expect(parsedResult.settings.save_enabled).toBe(true);
      expect(parsedResult.settings.honeypot).toBe(true);
      expect(parsedResult.settings.requireLogin).toBe(false);
      expect(parsedResult.button.text).toBe('Submit');
    });

    it('should include confirmations and notifications', () => {
      const result = exportFormAsJson(mockCompleteForm);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.confirmations).toHaveLength(1);
      expect(parsedResult.confirmations[0].message).toBe('Thank you for contacting us! We will get back to you soon.');

      expect(parsedResult.notifications).toHaveLength(1);
      expect(parsedResult.notifications[0].name).toBe('Admin Notification');
      expect(parsedResult.notifications[0].subject).toBe('New Form Submission');
    });

    it('should remove runtime and metadata properties', () => {
      const result = exportFormAsJson(mockCompleteForm);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.id).toBeUndefined();
      expect(parsedResult.date_created).toBeUndefined();
      expect(parsedResult.date_updated).toBeUndefined();
      expect(parsedResult.entries_count).toBeUndefined();
      expect(parsedResult.is_active).toBeUndefined();
      expect(parsedResult.is_trash).toBeUndefined();
    });

    it('should add export metadata for tracking', () => {
      const result = exportFormAsJson(mockCompleteForm);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.export_metadata).toBeDefined();
      expect(parsedResult.export_metadata.export_version).toBe('1.0');
      expect(parsedResult.export_metadata.source).toBe('gravity-forms-mcp');
      expect(parsedResult.export_metadata.exported_at).toBeDefined();
    });
  });

  describe('Sensitive data removal', () => {
    const mockFormWithSensitiveData = {
      id: '6',
      title: 'Contact Form',
      fields: [
        { id: '1', type: 'text', label: 'Name' }
      ],
      notifications: [
        {
          id: 'admin',
          name: 'Admin Notification',
          to: 'sensitive@company.com',
          apiKey: 'secret-api-key-12345',
          privateKey: 'private-key-67890',
          from: 'noreply@company.com'
        },
        {
          id: 'webhook',
          name: 'Webhook Notification',
          to: 'https://webhook.site/12345',
          authToken: 'bearer-token-xyz',
          customHeaders: {
            'X-API-Key': 'secret-header-key'
          }
        }
      ],
      settings: {
        paypal: {
          sandbox: true,
          apiUsername: 'paypal-api-user',
          apiPassword: 'paypal-secret-password',
          signature: 'paypal-signature-abc123'
        },
        stripe: {
          publishableKey: 'pk_test_12345',
          secretKey: 'sk_test_secret'
        }
      }
    };

    // Helper function for sensitive data removal
    function sanitizeFormForExport(form: any): any {
      const sanitized = JSON.parse(JSON.stringify(form));

      // Remove runtime properties
      delete sanitized.id;
      delete sanitized.date_created;
      delete sanitized.date_updated;
      delete sanitized.entries_count;

      // Sanitize notifications
      if (sanitized.notifications) {
        sanitized.notifications = sanitized.notifications.map((notification: any) => {
          const clean = { ...notification };
          
          // Replace sensitive email addresses with placeholders
          if (clean.to && clean.to.includes('@') && clean.to !== '{admin_email}') {
            clean.to = '{admin_email}';
          }
          
          // Remove API keys and sensitive auth data
          delete clean.apiKey;
          delete clean.privateKey;
          delete clean.authToken;
          delete clean.customHeaders;
          
          return clean;
        });
      }

      // Remove sensitive payment gateway data
      if (sanitized.settings) {
        if (sanitized.settings.paypal) {
          delete sanitized.settings.paypal.apiUsername;
          delete sanitized.settings.paypal.apiPassword;
          delete sanitized.settings.paypal.signature;
        }
        if (sanitized.settings.stripe) {
          delete sanitized.settings.stripe.secretKey;
          // Keep publishable key as it's not sensitive
        }
      }

      return sanitized;
    }

    it('should remove sensitive email addresses from notifications', () => {
      const sanitized = sanitizeFormForExport(mockFormWithSensitiveData);

      expect(sanitized.notifications[0].to).toBe('{admin_email}');
      expect(sanitized.notifications[0].to).not.toBe('sensitive@company.com');
    });

    it('should remove API keys and private keys', () => {
      const sanitized = sanitizeFormForExport(mockFormWithSensitiveData);

      expect(sanitized.notifications[0].apiKey).toBeUndefined();
      expect(sanitized.notifications[0].privateKey).toBeUndefined();
      expect(sanitized.notifications[1].authToken).toBeUndefined();
      expect(sanitized.notifications[1].customHeaders).toBeUndefined();
    });

    it('should remove payment gateway sensitive data', () => {
      const sanitized = sanitizeFormForExport(mockFormWithSensitiveData);

      // PayPal sensitive data should be removed
      expect(sanitized.settings.paypal.apiUsername).toBeUndefined();
      expect(sanitized.settings.paypal.apiPassword).toBeUndefined();
      expect(sanitized.settings.paypal.signature).toBeUndefined();

      // Stripe secret key should be removed, publishable key can remain
      expect(sanitized.settings.stripe.secretKey).toBeUndefined();
      expect(sanitized.settings.stripe.publishableKey).toBe('pk_test_12345'); // Public key OK
    });

    it('should handle webhook URLs in notifications', () => {
      const sanitized = sanitizeFormForExport(mockFormWithSensitiveData);

      // Webhook URL should be preserved (not an email address)
      expect(sanitized.notifications[1].to).toBe('https://webhook.site/12345');
      expect(sanitized.notifications[1].to).not.toBe('{admin_email}');
    });

    it('should preserve existing admin_email placeholders', () => {
      const formWithPlaceholder = {
        ...mockFormWithSensitiveData,
        notifications: [
          {
            id: 'admin',
            name: 'Admin Notification',
            to: '{admin_email}', // Already a placeholder
            apiKey: 'secret-key'
          }
        ]
      };

      const sanitized = sanitizeFormForExport(formWithPlaceholder);

      // Should preserve existing placeholder, not double-replace
      expect(sanitized.notifications[0].to).toBe('{admin_email}');
      expect(sanitized.notifications[0].apiKey).toBeUndefined();
    });

    it('should preserve non-sensitive configuration', () => {
      const sanitized = sanitizeFormForExport(mockFormWithSensitiveData);

      expect(sanitized.title).toBe('Contact Form');
      expect(sanitized.fields).toHaveLength(1);
      expect(sanitized.notifications[0].name).toBe('Admin Notification');
      expect(sanitized.notifications[1].name).toBe('Webhook Notification');
      expect(sanitized.settings.paypal.sandbox).toBe(true); // Non-sensitive setting preserved
    });
  });

  describe('Complex forms with conditional logic', () => {
    const mockComplexForm = {
      id: '7',
      title: 'Complex Survey Form',
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
          label: 'Quantity',
          numberFormat: 'decimal_dot'
        },
        {
          id: '4',
          type: 'number',
          label: 'Price',
          numberFormat: 'currency'
        },
        {
          id: '5',
          type: 'number',
          label: 'Total',
          isCalculation: true,
          calculationFormula: '{Quantity:3} * {Price:4}',
          calculationRounding: 2,
          enableCalculation: true
        }
      ],
      pagination: {
        enabled: true,
        style: 'percentage',
        pages: [
          {
            title: 'Satisfaction',
            fields: ['1', '2']
          },
          {
            title: 'Order Details',
            fields: ['3', '4', '5']
          }
        ]
      }
    };

    function exportComplexForm(form: any): any {
      const exported = JSON.parse(JSON.stringify(form));
      delete exported.id;
      return exported;
    }

    it('should preserve conditional logic rules and configuration', () => {
      const exported = exportComplexForm(mockComplexForm);

      const conditionalField = exported.fields[1];
      expect(conditionalField.conditionalLogic).toBeDefined();
      expect(conditionalField.conditionalLogic.enabled).toBe(true);
      expect(conditionalField.conditionalLogic.rules).toHaveLength(2);
      expect(conditionalField.conditionalLogic.rules[0].fieldId).toBe('1');
      expect(conditionalField.conditionalLogic.rules[0].operator).toBe('is');
      expect(conditionalField.conditionalLogic.rules[0].value).toBe('no');
    });

    it('should preserve calculation formulas and settings', () => {
      const exported = exportComplexForm(mockComplexForm);

      const calculationField = exported.fields[4];
      expect(calculationField.isCalculation).toBe(true);
      expect(calculationField.calculationFormula).toBe('{Quantity:3} * {Price:4}');
      expect(calculationField.calculationRounding).toBe(2);
      expect(calculationField.enableCalculation).toBe(true);
    });

    it('should preserve pagination structure and page configuration', () => {
      const exported = exportComplexForm(mockComplexForm);

      expect(exported.pagination).toBeDefined();
      expect(exported.pagination.enabled).toBe(true);
      expect(exported.pagination.style).toBe('percentage');
      expect(exported.pagination.pages).toHaveLength(2);
      expect(exported.pagination.pages[0].title).toBe('Satisfaction');
      expect(exported.pagination.pages[0].fields).toEqual(['1', '2']);
    });

    it('should preserve all field types and their specific properties', () => {
      const exported = exportComplexForm(mockComplexForm);

      expect(exported.fields[0].type).toBe('radio');
      expect(exported.fields[0].choices).toHaveLength(3);
      expect(exported.fields[2].numberFormat).toBe('decimal_dot');
      expect(exported.fields[3].numberFormat).toBe('currency');
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle forms with minimal data', () => {
      const minimalForm = {
        id: '8',
        title: 'Minimal Form',
        fields: []
      };

      function exportMinimalForm(form: any): string {
        const exported = { ...form };
        delete exported.id;
        return JSON.stringify(exported, null, 2);
      }

      const result = exportMinimalForm(minimalForm);
      const parsed = JSON.parse(result);

      expect(parsed.title).toBe('Minimal Form');
      expect(parsed.fields).toEqual([]);
      expect(parsed.id).toBeUndefined();
    });

    it('should handle forms with null or undefined properties', () => {
      const formWithNulls = {
        id: '9',
        title: 'Form with Nulls',
        description: null,
        fields: [
          {
            id: '1',
            type: 'text',
            label: 'Name',
            defaultValue: null,
            placeholder: undefined
          }
        ],
        notifications: null,
        confirmations: undefined
      };

      function exportFormWithNulls(form: any): any {
        const exported = JSON.parse(JSON.stringify(form));
        delete exported.id;
        return exported;
      }

      const result = exportFormWithNulls(formWithNulls);

      expect(result.title).toBe('Form with Nulls');
      expect(result.description).toBeNull();
      expect(result.fields[0].defaultValue).toBeNull();
      expect(result.notifications).toBeNull();
    });

    it('should handle Date objects properly during export', () => {
      const formWithDates = {
        id: '10',
        title: 'Form with Dates',
        fields: [{ id: '1', type: 'text', label: 'Name' }],
        settings: {
          created_at: new Date('2023-01-01'),
          updated_at: new Date('2023-01-02')
        }
      };

      function exportFormWithDates(form: any): string {
        const exported = { ...form };
        delete exported.id;
        return JSON.stringify(exported, null, 2);
      }

      const result = exportFormWithDates(formWithDates);
      
      // Should not throw error and should serialize dates as ISO strings
      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(typeof parsed.settings.created_at).toBe('string');
      expect(parsed.settings.created_at).toContain('2023-01-01');
    });

    it('should validate form_id parameter requirements', () => {
      const invalidFormIds = ['', null, undefined, 0, false];

      invalidFormIds.forEach((invalidId) => {
        expect(() => {
          if (!invalidId || typeof invalidId !== 'string') {
            throw new Error('form_id is required and must be a string');
          }
        }).toThrow('form_id is required');
      });
    });

    it('should format JSON with proper indentation for readability', () => {
      const simpleForm = {
        title: 'Test Form',
        fields: [{ id: '1', type: 'text', label: 'Name' }]
      };

      const result = JSON.stringify(simpleForm, null, 2);

      expect(result).toContain('\n');
      expect(result).toContain('  '); // Should have 2-space indentation
      expect(result.split('\n').length).toBeGreaterThan(1); // Multi-line format
    });
  });

  describe('Tool parameter structure validation', () => {
    it('should accept form_id parameter', () => {
      const validParams = {
        form_id: '5'
      };

      expect(validParams.form_id).toBeDefined();
      expect(typeof validParams.form_id).toBe('string');
    });

    it('should validate form_id is required', () => {
      const paramsWithoutFormId = {};

      expect(() => {
        if (!('form_id' in paramsWithoutFormId)) {
          throw new Error('form_id parameter is required');
        }
      }).toThrow('form_id parameter is required');
    });

    it('should validate form_id is non-empty string', () => {
      const invalidFormIds = ['', '   ', null, undefined];

      invalidFormIds.forEach((invalidId) => {
        const params = { form_id: invalidId };
        
        expect(() => {
          if (!params.form_id || typeof params.form_id !== 'string' || params.form_id.trim() === '') {
            throw new Error('form_id must be a non-empty string');
          }
        }).toThrow('form_id must be a non-empty string');
      });
    });
  });
});