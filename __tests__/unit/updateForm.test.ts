// ABOUTME: Unit tests for update_form tool in Gravity Forms MCP Server
// ABOUTME: Tests form updating functionality with API integration and error handling

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
 
 
 
 
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable jest/prefer-strict-equal */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { GravityFormsMocks } from '../mocks/gravityFormsMocks';
import { TOOL_SCHEMAS } from '../../utils/toolSchemas';

describe('Update Form Tool', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Set test environment variables
    process.env.GRAVITY_FORMS_BASE_URL = 'https://test.example.com';
    process.env.GRAVITY_FORMS_CONSUMER_KEY = 'test_key';
    process.env.GRAVITY_FORMS_CONSUMER_SECRET = 'test_secret';
    process.env.GRAVITY_FORMS_AUTH_METHOD = 'basic';

    // Clear module cache to ensure fresh imports
    jest.clearAllMocks();
    
    // Clear module cache for clean server instances
    delete require.cache[require.resolve('../../index')];
    
    // Reset global fetch mock
    if (global.fetch) {
      (global.fetch as jest.Mock).mockClear();
    }
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    
    // Clean up global mocks
    if (global.fetch && typeof global.fetch === 'function' && 'mockRestore' in global.fetch) {
      (global.fetch as jest.Mock).mockRestore();
    }
  });

  // The tool definitions come from TOOL_SCHEMAS (Zod), which McpServer.registerTool
  // converts to wire-format JSON schema internally; these tests inspect that same
  // conversion directly instead of capturing the (now removed) low-level request handler.
  describe('Tool Registration', () => {
    it('should list update_form in available tools', () => {
      expect(Object.keys(TOOL_SCHEMAS)).toContain('update_form');
    });

    it('should have correct tool description', () => {
      expect(TOOL_SCHEMAS.update_form.description).toBe('Replace an existing form with a full form definition. Both title and fields are required — the form is fully replaced, so any fields omitted from the payload will be removed.');
    });

    it('should have correct required parameters in input schema', () => {
      const generated: any = zodToJsonSchema(z.object(TOOL_SCHEMAS.update_form.inputSchema), { target: 'jsonSchema7' });
      // form_id is the only schema-level required property; title/fields are validated at runtime
      expect(generated.required).toEqual(expect.arrayContaining(['form_id']));
      expect(generated.required).toHaveLength(1);
    });

    it('should have proper input schema structure', () => {
      const generated: any = zodToJsonSchema(z.object(TOOL_SCHEMAS.update_form.inputSchema), { target: 'jsonSchema7' });
      const { properties } = generated;
      expect(properties.form_id).toMatchObject({
        type: 'string',
        description: 'ID of the form to update'
      });
      expect(properties.title).toMatchObject({
        type: 'string',
        description: 'Updated form title'
      });
      expect(properties.fields).toMatchObject({
        type: 'array',
        description: 'Updated array of field objects'
      });
    });

    it('should have optional parameters defined', () => {
      const generated: any = zodToJsonSchema(z.object(TOOL_SCHEMAS.update_form.inputSchema), { target: 'jsonSchema7' });
      const { properties } = generated;
      expect(properties.description).toBeDefined();
      expect(properties.description.type).toBe('string');
      expect(properties.description.description).toContain('form description');
    });
  });

  describe('Update Form Success', () => {
    beforeEach(() => {
      // Setup global fetch mock for each test
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
    });

    it('should successfully update a form with valid parameters', async () => {
      const { GravityFormsMCPServer } = require('../../index');

      const updateFormData = {
        form_id: '1',
        title: 'Updated Contact Form',
        fields: [
          { id: 1, type: 'text', label: 'Updated First Name', isRequired: true },
          { id: 2, type: 'email', label: 'Updated Email Address', isRequired: true }
        ],
        description: 'Updated form description'
      };

      const mockUpdatedForm = {
        id: '1',
        title: 'Updated Contact Form', 
        description: 'Updated form description',
        fields: updateFormData.fields,
        is_active: '1',
        date_created: '2024-01-01 10:00:00'
      };

      // Mock successful API response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockUpdatedForm
      });

      // Mock the tool handler
      const server = new GravityFormsMCPServer();

      const response = await (server).dispatchTool('update_form', updateFormData);

      expect(response.content[0].text).toContain('Successfully updated form');
      expect(response.content[0].text).toContain('Updated Contact Form');
      expect(response.content[0].text).toContain(JSON.stringify(mockUpdatedForm, null, 2));
      
      // Verify the correct API endpoint was called with PUT method
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/forms/1'),
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Authorization': expect.stringMatching(/^Basic /),
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            title: 'Updated Contact Form',
            fields: updateFormData.fields,
            description: 'Updated form description'
          })
        })
      );
    });

    it('should make PUT request to correct endpoint', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const updateFormData = {
        form_id: '123',
        title: 'Test Form Update',
        fields: [{ id: 1, type: 'text', label: 'Test Field' }]
      };

      const mockResponse = {
        id: '123',
        title: 'Test Form Update',
        fields: updateFormData.fields
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const server = new GravityFormsMCPServer();

      await (server).dispatchTool('update_form', updateFormData);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/wp-json/gf/v2/forms/123'),
        expect.objectContaining({
          method: 'PUT'
        })
      );
    });

    it('should include title and fields in request body', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const updateFormData = {
        form_id: '1',
        title: 'Required Title',
        fields: [
          { id: 1, type: 'text', label: 'Required Field' }
        ]
      };

      const mockResponse = {
        id: '1',
        title: 'Required Title',
        fields: updateFormData.fields
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const server = new GravityFormsMCPServer();

      await (server).dispatchTool('update_form', updateFormData);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: JSON.stringify({
            title: 'Required Title',
            fields: [{ id: 1, type: 'text', label: 'Required Field' }]
          })
        })
      );
    });

    it('should return updated form data in response', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const updateFormData = {
        form_id: '5',
        title: 'Response Test Form',
        fields: [
          { id: 1, type: 'text', label: 'Response Field' }
        ]
      };

      const mockUpdatedForm = {
        id: '5',
        title: 'Response Test Form',
        fields: updateFormData.fields,
        is_active: '1',
        date_created: '2024-01-01 12:00:00',
        date_updated: '2024-01-01 15:30:00'
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockUpdatedForm
      });

      const server = new GravityFormsMCPServer();

      const response = await (server).dispatchTool('update_form', updateFormData);

      expect(response.content[0].text).toContain('Response Test Form');
      expect(response.content[0].text).toContain('"id": "5"');
      expect(response.content[0].text).toContain('"date_updated": "2024-01-01 15:30:00"');
      expect(response.content[0].text).toContain('Response Field');
    });
  });

  describe('Parameter Validation', () => {
    beforeEach(() => {
      // Setup global fetch mock for each test
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
    });

    it('should throw InvalidParams error when form_id is missing', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const invalidData = {
        // form_id missing
        title: 'Test Form',
        fields: [{ id: 1, type: 'text', label: 'Test Field' }]
      };

      const server = new GravityFormsMCPServer();

      await expect((server).dispatchTool('update_form', invalidData)).rejects.toThrow('form_id is required');
    });

    it('should throw InvalidParams error when title is missing', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const invalidData = {
        form_id: '1',
        // title missing
        fields: [{ id: 1, type: 'text', label: 'Test Field' }]
      };

      const server = new GravityFormsMCPServer();

      await expect((server).dispatchTool('update_form', invalidData)).rejects.toThrow('title is required');
    });

    it('should throw InvalidParams error when fields is missing', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const invalidData = {
        form_id: '1',
        title: 'Test Form'
        // fields missing
      };

      const server = new GravityFormsMCPServer();

      await expect((server).dispatchTool('update_form', invalidData)).rejects.toThrow('fields is required');
    });

    it('should reject invalid form_id format', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const invalidData = {
        form_id: '', // empty string
        title: 'Test Form',
        fields: [{ id: 1, type: 'text', label: 'Test Field' }]
      };

      const server = new GravityFormsMCPServer();

      await expect((server).dispatchTool('update_form', invalidData)).rejects.toThrow('form_id must be a non-empty string');
    });

    it('should reject when fields is not an array', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const invalidData = {
        form_id: '1',
        title: 'Test Form',
        fields: 'not an array' // invalid type
      };

      const server = new GravityFormsMCPServer();

      await expect((server).dispatchTool('update_form', invalidData)).rejects.toThrow('fields must be an array');
    });

    it('should reject when title is empty string', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const invalidData = {
        form_id: '1',
        title: '', // empty title
        fields: [{ id: 1, type: 'text', label: 'Test Field' }]
      };

      const server = new GravityFormsMCPServer();

      await expect((server).dispatchTool('update_form', invalidData)).rejects.toThrow('title must be a non-empty string');
    });

    it('should reject when form_id is not a string', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const invalidData = {
        form_id: 123, // number instead of string
        title: 'Test Form',
        fields: [{ id: 1, type: 'text', label: 'Test Field' }]
      };

      const server = new GravityFormsMCPServer();

      await expect((server).dispatchTool('update_form', invalidData)).rejects.toThrow('form_id must be a string');
    });

    it('should reject when title is not a string', async () => {
      const { GravityFormsMCPServer } = require('../../index');
      
      const invalidData = {
        form_id: '1',
        title: { name: 'Test Form' }, // object instead of string
        fields: [{ id: 1, type: 'text', label: 'Test Field' }]
      };

      const server = new GravityFormsMCPServer();

      await expect((server).dispatchTool('update_form', invalidData)).rejects.toThrow('title must be a string');
    });
  });

  describe('Advanced Features', () => {
    beforeEach(() => {
      // Setup global fetch mock for each test
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
    });

    describe('Field Type Validation', () => {
      it('should warn about unknown field types when validate_fields option is enabled', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        // Mock console.error to capture debug warnings (debug output uses stderr to avoid corrupting MCP stdio)
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form",
            fields: [{ type: "invalid_type", label: "Test Field" }]
          })
        });

        const invalidFields = [
          { type: "invalid_type", label: "Test Field" }
        ];

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: invalidFields,
          validate_fields: true,
          debug: true  // Enable debug to see warnings
        };

        const response = await server.updateForm(updateData);
        
        // Should succeed but log a warning
        expect(response.content[0].text).toContain('Successfully updated form');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: Unknown field type 'invalid_type'"));
        
        consoleSpy.mockRestore();
      });

      it('should allow valid field types when validation is enabled', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form",
            fields: [{ type: "text", label: "Valid Field" }]
          })
        });

        const validFields = [
          { type: "text", label: "Text Field" },
          { type: "email", label: "Email Field" },
          { type: "number", label: "Number Field" }
        ];

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: validFields,
          validate_fields: true
        };

        const response = await server.updateForm(updateData);
        expect(response.content[0].text).toContain('Successfully updated form');
      });

      it('should skip field validation by default', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1", 
            title: "Test Form",
            fields: [{ type: "custom_type", label: "Custom Field" }]
          })
        });

        const customFields = [
          { type: "custom_type", label: "Custom Field" }
        ];

        const updateData = {
          form_id: "1",
          title: "Test Form", 
          fields: customFields
        };

        const response = await server.updateForm(updateData);
        expect(response.content[0].text).toContain('Successfully updated form');
      });
    });

    describe('Response Formatting Options', () => {
      it('should support compact response format', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form",
            fields: [{ type: "text", label: "Test Field" }]
          })
        });

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: [{ type: "text", label: "Test Field" }],
          response_format: "compact"
        };

        const response = await server.updateForm(updateData);
        
        expect(response.content[0].text).toContain('Form updated successfully');
        expect(response.content[0].text).toContain('ID: 1');
        expect(response.content[0].text).toContain('Title: Test Form');
        expect(response.content[0].text).not.toContain('"fields":'); // Should not include full JSON
      });

      it('should support detailed response format (default)', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form",
            fields: [{ type: "text", label: "Test Field" }]
          })
        });

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: [{ type: "text", label: "Test Field" }]
        };

        const response = await server.updateForm(updateData);
        
        expect(response.content[0].text).toContain('Successfully updated form:');
        expect(response.content[0].text).toContain('"id": "1"');
        expect(response.content[0].text).toContain('"title": "Test Form"');
        expect(response.content[0].text).toContain('"fields":'); // Should include full JSON
      });

      it('should support minimal response format', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form"
          })
        });

        const updateData = {
          form_id: "1", 
          title: "Test Form",
          fields: [{ type: "text", label: "Test Field" }],
          response_format: "minimal"
        };

        const response = await server.updateForm(updateData);
        
        expect(response.content[0].text).toBe('Form 1 updated successfully');
      });
    });

    describe('Settings and Notifications Support', () => {
      it('should support updating form settings', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form",
            fields: [{ type: "text", label: "Test Field" }],
            confirmations: { 1: { message: "Thank you!" } },
            notifications: { 1: { to: "admin@test.com" } }
          })
        });

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: [{ type: "text", label: "Test Field" }],
          confirmations: { 1: { message: "Updated thank you!" } },
          notifications: { 1: { to: "newemail@test.com" } }
        };

        const response = await server.updateForm(updateData);
        
        expect(response.content[0].text).toContain('Successfully updated form');
        
        // Verify the request body included confirmations and notifications
        const lastCall = global.fetch.mock.calls[global.fetch.mock.calls.length - 1];
        const requestBody = JSON.parse(lastCall[1].body);
        expect(requestBody.confirmations).toEqual({ 1: { message: "Updated thank you!" } });
        expect(requestBody.notifications).toEqual({ 1: { to: "newemail@test.com" } });
      });

    });

    describe('Logging and Debugging', () => {
      it('should include debug information when debug option is enabled', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        // Mock console.error to capture debug output (debug output uses stderr to avoid corrupting MCP stdio)
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form",
            fields: [{ type: "text", label: "Test Field" }]
          })
        });

        const updateData = {
          form_id: "1",
          title: "Test Form", 
          fields: [{ type: "text", label: "Test Field" }],
          debug: true
        };

        const response = await server.updateForm(updateData);
        
        // Verify debug logging occurred
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[UPDATE_FORM_DEBUG]'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('form_id: 1'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Request body size:'));
        
        expect(response.content[0].text).toContain('Successfully updated form');
        
        consoleSpy.mockRestore();
      });

      it('should include performance timing when debug is enabled', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        // Debug output uses stderr to avoid corrupting MCP stdio
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form",
            fields: [{ type: "text", label: "Test Field" }]
          })
        });

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: [{ type: "text", label: "Test Field" }],
          debug: true
        };

        const response = await server.updateForm(updateData);
        
        // Verify performance timing was logged
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Update completed in'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ms'));
        
        consoleSpy.mockRestore();
      });

      it('should not log debug information by default', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Test Form",
            fields: [{ type: "text", label: "Test Field" }]
          })
        });

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: [{ type: "text", label: "Test Field" }]
        };

        const response = await server.updateForm(updateData);
        
        // Verify no debug logging occurred
        expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('[UPDATE_FORM_DEBUG]'));
        
        consoleSpy.mockRestore();
      });
    });
  });

  describe('Integration Testing', () => {
    beforeEach(() => {
      // Setup global fetch mock for each test
      const mockFetch = jest.fn();
      global.fetch = mockFetch;
    });

    describe('Comprehensive Form Updates', () => {
      it('should update a form with all optional parameters', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Comprehensive Test Form",
            description: "Updated comprehensive description", 
            fields: [
              { type: "text", id: 1, label: "Full Name", isRequired: true },
              { type: "email", id: 2, label: "Email Address", isRequired: true },
              { type: "select", id: 3, label: "Country", choices: [
                { text: "USA", value: "us" },
                { text: "Canada", value: "ca" }
              ]}
            ],
            confirmations: {
              "1": { message: "Thank you for your submission!" }
            },
            notifications: {
              "1": { to: "admin@test.com", subject: "New submission" }
            },
            labelPlacement: "top_label",
            descriptionPlacement: "below",
            button: { type: "text", text: "Submit Form" },
            is_active: "1",
            date_created: "2024-01-01 10:00:00",
            is_trash: "0"
          })
        });

        const comprehensiveUpdateData = {
          form_id: "1",
          title: "Comprehensive Test Form",
          description: "Updated comprehensive description",
          fields: [
            { type: "text", id: 1, label: "Full Name", isRequired: true },
            { type: "email", id: 2, label: "Email Address", isRequired: true },
            { type: "select", id: 3, label: "Country", choices: [
              { text: "USA", value: "us" },
              { text: "Canada", value: "ca" }
            ]}
          ],
          confirmations: {
            "1": { message: "Thank you for your submission!" }
          },
          notifications: {
            "1": { to: "admin@test.com", subject: "New submission" }
          },
          labelPlacement: "top_label",
          descriptionPlacement: "below",
          button: { type: "text", text: "Submit Form" }
        };

        const response = await server.updateForm(comprehensiveUpdateData);

        expect(response.content[0].text).toContain('Successfully updated form');
        expect(response.content[0].text).toContain('Comprehensive Test Form');
        expect(response.content[0].text).toContain('confirmations');
        expect(response.content[0].text).toContain('notifications');
        expect(response.content[0].text).toContain('labelPlacement');

        // Verify the API was called correctly
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms/1'),
          expect.objectContaining({
            method: 'PUT',
            headers: expect.objectContaining({
              'Authorization': expect.stringMatching(/^Basic /),
              'Content-Type': 'application/json'
            }),
            body: expect.stringContaining('Comprehensive Test Form')
          })
        );
      });

    });

    describe('Error Handling Integration', () => {
      it('should handle non-existent form gracefully', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

        const updateData = {
          form_id: "999",
          title: "Non-existent Form",
          fields: [{ type: "text", label: "Test Field" }]
        };

        await expect(server.updateForm(updateData)).rejects.toThrow('API request failed: HTTP 404: Not Found');
      });

      it('should handle API server errors gracefully', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'));

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: [{ type: "text", label: "Test Field" }]
        };

        await expect(server.updateForm(updateData)).rejects.toThrow('API request failed: HTTP 500: Internal Server Error');
      });

      it('should handle network errors gracefully', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockRejectedValueOnce(new Error('Network request failed'));

        const updateData = {
          form_id: "1",
          title: "Test Form",
          fields: [{ type: "text", label: "Test Field" }]
        };

        await expect(server.updateForm(updateData)).rejects.toThrow('API request failed: Network request failed');
      });
    });

    describe('Field Types and Configurations', () => {
      it('should handle various field types correctly', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "3",
            title: "Multi Field Type Form",
            fields: [
              { type: "text", id: 1, label: "Text Field" },
              { type: "email", id: 2, label: "Email Field" },
              { type: "number", id: 3, label: "Number Field" },
              { type: "select", id: 4, label: "Select Field", choices: [] },
              { type: "checkbox", id: 5, label: "Checkbox Field" },
              { type: "radio", id: 6, label: "Radio Field", choices: [] },
              { type: "textarea", id: 7, label: "Textarea Field" },
              { type: "date", id: 8, label: "Date Field" },
              { type: "phone", id: 9, label: "Phone Field" },
              { type: "name", id: 10, label: "Name Field", inputs: [] }
            ]
          })
        });

        const multiFieldTypeData = {
          form_id: "3",
          title: "Multi Field Type Form", 
          fields: [
            { type: "text", id: 1, label: "Text Field" },
            { type: "email", id: 2, label: "Email Field" },
            { type: "number", id: 3, label: "Number Field" },
            { type: "select", id: 4, label: "Select Field", choices: [] },
            { type: "checkbox", id: 5, label: "Checkbox Field" },
            { type: "radio", id: 6, label: "Radio Field", choices: [] },
            { type: "textarea", id: 7, label: "Textarea Field" },
            { type: "date", id: 8, label: "Date Field" },
            { type: "phone", id: 9, label: "Phone Field" },
            { type: "name", id: 10, label: "Name Field", inputs: [] }
          ],
          validate_fields: true
        };

        const response = await server.updateForm(multiFieldTypeData);

        expect(response.content[0].text).toContain('Successfully updated form');
        expect(response.content[0].text).toContain('Multi Field Type Form');

        // Verify all field types are present in response
        const fieldTypes = ['text', 'email', 'number', 'select', 'checkbox', 'radio', 'textarea', 'date', 'phone', 'name'];
        fieldTypes.forEach(fieldType => {
          expect(response.content[0].text).toContain(fieldType);
        });
      });

      it('should handle complex field configurations', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "4",
            title: "Complex Configuration Form",
            fields: [
              {
                type: "select",
                id: 1,
                label: "Product Category",
                isRequired: true,
                choices: [
                  { text: "Electronics", value: "electronics", isSelected: false },
                  { text: "Clothing", value: "clothing", isSelected: true },
                  { text: "Books", value: "books", isSelected: false }
                ],
                size: "medium",
                cssClass: "custom-select"
              },
              {
                type: "name",
                id: 2,
                label: "Customer Name", 
                isRequired: true,
                inputs: [
                  { id: "2.3", label: "First", name: "input_2_3" },
                  { id: "2.6", label: "Last", name: "input_2_6" }
                ]
              }
            ]
          })
        });

        const complexConfigData = {
          form_id: "4",
          title: "Complex Configuration Form",
          fields: [
            {
              type: "select",
              id: 1,
              label: "Product Category",
              isRequired: true,
              choices: [
                { text: "Electronics", value: "electronics", isSelected: false },
                { text: "Clothing", value: "clothing", isSelected: true },
                { text: "Books", value: "books", isSelected: false }
              ],
              size: "medium",
              cssClass: "custom-select"
            },
            {
              type: "name",
              id: 2,
              label: "Customer Name",
              isRequired: true,
              inputs: [
                { id: "2.3", label: "First", name: "input_2_3" },
                { id: "2.6", label: "Last", name: "input_2_6" }
              ]
            }
          ]
        };

        const response = await server.updateForm(complexConfigData);

        expect(response.content[0].text).toContain('Successfully updated form');
        expect(response.content[0].text).toContain('Product Category');
        expect(response.content[0].text).toContain('Customer Name');
        expect(response.content[0].text).toContain('isRequired');
        expect(response.content[0].text).toContain('choices');
        expect(response.content[0].text).toContain('inputs');
      });
    });

    describe('Backward Compatibility', () => {
      it('should not interfere with existing create_form functionality', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "5",
            title: "New Form via Create",
            fields: [{ type: "text", id: 1, label: "Test Field" }]
          })
        });

        // Test that create_form still works after adding update_form
        const createFormData = {
          title: "New Form via Create",
          fields: [{ type: "text", id: 1, label: "Test Field" }]
        };

        const response = await server.createForm(createFormData);

        expect(response.content[0].text).toContain('Form Created:');
        expect(response.content[0].text).toContain('New Form via Create');

        // Verify POST method was used (not PUT)
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/forms'),
          expect.objectContaining({
            method: 'POST'
          })
        );
      });

      it('should maintain consistent response format with other tools', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "6",
            title: "Consistency Test Form",
            fields: [{ type: "text", id: 1, label: "Consistent Field" }]
          })
        });

        const updateData = {
          form_id: "6",
          title: "Consistency Test Form",
          fields: [{ type: "text", id: 1, label: "Consistent Field" }]
        };

        const response = await server.updateForm(updateData);

        // Verify response structure matches other tools
        expect(response).toHaveProperty('content');
        expect(Array.isArray(response.content)).toBe(true);
        expect(response.content).toHaveLength(1);
        expect(response.content[0]).toHaveProperty('type', 'text');
        expect(response.content[0]).toHaveProperty('text');
        expect(typeof response.content[0].text).toBe('string');
      });

      it('should work correctly alongside get_forms functionality', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        // Mock get_forms response
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            "1": {
              id: "1",
              title: "Existing Form",
              fields: []
            }
          })
        });

        // Test get_forms still works
        const getFormsResponse = await server.getForms({});
        expect(getFormsResponse.content[0].text).toContain('Existing Form');

        // Now test update_form on the same form
        global.fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: "1",
            title: "Updated Existing Form",
            fields: [{ type: "text", id: 1, label: "Updated Field" }]
          })
        });

        const updateData = {
          form_id: "1",
          title: "Updated Existing Form",
          fields: [{ type: "text", id: 1, label: "Updated Field" }]
        };

        const updateResponse = await server.updateForm(updateData);
        expect(updateResponse.content[0].text).toContain('Updated Existing Form');

        // Both should have been successful
        expect(getFormsResponse).toBeDefined();
        expect(updateResponse).toBeDefined();
      });
    });

    describe('Concurrent Update Scenarios', () => {
      it('should handle multiple rapid updates correctly', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        // Mock multiple successful responses
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              id: "7",
              title: "Update 1",
              fields: [{ type: "text", id: 1, label: "Field 1" }]
            })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              id: "7",
              title: "Update 2", 
              fields: [{ type: "email", id: 2, label: "Field 2" }]
            })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              id: "7",
              title: "Update 3",
              fields: [{ type: "number", id: 3, label: "Field 3" }]
            })
          });

        const update1 = server.updateForm({
          form_id: "7",
          title: "Update 1",
          fields: [{ type: "text", id: 1, label: "Field 1" }]
        });

        const update2 = server.updateForm({
          form_id: "7", 
          title: "Update 2",
          fields: [{ type: "email", id: 2, label: "Field 2" }]
        });

        const update3 = server.updateForm({
          form_id: "7",
          title: "Update 3",
          fields: [{ type: "number", id: 3, label: "Field 3" }]
        });

        const [response1, response2, response3] = await Promise.all([update1, update2, update3]);

        expect(response1.content[0].text).toContain('Update 1');
        expect(response2.content[0].text).toContain('Update 2');
        expect(response3.content[0].text).toContain('Update 3');

        // All three API calls should have been made
        expect(global.fetch).toHaveBeenCalledTimes(3);
      });

      it('should handle mixed success and failure scenarios', async () => {
        const { GravityFormsMCPServer } = require('../../index');
        const server = new GravityFormsMCPServer();

        // Mock mixed responses
        global.fetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              id: "8",
              title: "Successful Update",
              fields: [{ type: "text", id: 1, label: "Success Field" }]
            })
          })
          .mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

        const successUpdate = server.updateForm({
          form_id: "8",
          title: "Successful Update",
          fields: [{ type: "text", id: 1, label: "Success Field" }]
        });

        const failureUpdate = server.updateForm({
          form_id: "999",
          title: "Failed Update", 
          fields: [{ type: "text", id: 1, label: "Fail Field" }]
        });

        const successResponse = await successUpdate;
        expect(successResponse.content[0].text).toContain('Successful Update');

        await expect(failureUpdate).rejects.toThrow('API request failed: HTTP 404: Not Found');
      });
    });
  });
});