// ABOUTME: Mock utilities for Gravity Forms API responses and test data
// ABOUTME: Provides consistent test data for unit and integration tests

export interface MockForm {
  id: string;
  title: string;
  description: string;
  fields: MockField[];
  is_active: string;  // Gravity Forms API returns "1" or "0"
  date_created: string;
}

export interface MockField {
  id: number;
  type: string;
  label: string;
  isRequired: boolean;
  inputs?: MockInput[];
}

export interface MockInput {
  id: string;
  label: string;
  name: string;
}

export interface MockEntry {
  id: string;
  form_id: string;
  date_created: string;
  [key: string]: any;
}

export class GravityFormsMocks {
  static getMockForm(overrides: Partial<MockForm> = {}): MockForm {
    return {
      id: '1',
      title: 'Test Contact Form',
      description: 'A test contact form for unit testing',
      fields: [
        {
          id: 1,
          type: 'text',
          label: 'First Name',
          isRequired: true
        },
        {
          id: 2,
          type: 'text',
          label: 'Last Name',
          isRequired: true
        },
        {
          id: 3,
          type: 'email',
          label: 'Email Address',
          isRequired: true
        },
        {
          id: 4,
          type: 'textarea',
          label: 'Message',
          isRequired: false
        }
      ],
      is_active: "1",
      date_created: '2024-01-01 12:00:00',
      ...overrides
    };
  }

  static getMockForms(): MockForm[] {
    return [
      this.getMockForm(),
      this.getMockForm({
        id: '2',
        title: 'Newsletter Signup',
        description: 'Newsletter subscription form',
        fields: [
          {
            id: 1,
            type: 'email',
            label: 'Email Address',
            isRequired: true
          },
          {
            id: 2,
            type: 'checkbox',
            label: 'Subscribe to newsletter',
            isRequired: false
          }
        ]
      })
    ];
  }

  static getMockEntry(overrides: Partial<MockEntry> = {}): MockEntry {
    return {
      id: '1',
      form_id: '1',
      date_created: '2024-01-01 12:00:00',
      '1': 'John',
      '2': 'Doe',
      '3': 'john.doe@example.com',
      '4': 'This is a test message',
      ...overrides
    };
  }

  static getMockEntries(): MockEntry[] {
    return [
      this.getMockEntry(),
      this.getMockEntry({
        id: '2',
        '1': 'Jane',
        '2': 'Smith',
        '3': 'jane.smith@example.com',
        '4': 'Another test message'
      })
    ];
  }

  static getMockFormSubmissionResponse() {
    return {
      is_valid: true,
      page_number: 1,
      source_page_number: 1,
      confirmation_message: 'Thank you for your submission!',
      entry_id: '123'
    };
  }

  static getMockValidationResponse(isValid = true) {
    return {
      is_valid: isValid,
      validation_messages: isValid ? {} : {
        '1': 'This field is required',
        '3': 'Please enter a valid email address'
      }
    };
  }

  static getMockApiError(status = 404, message = 'Not Found') {
    return {
      status,
      statusText: message,
      ok: false,
      json: async () => ({
        code: `rest_${message.toLowerCase().replace(' ', '_')}`,
        message,
        data: { status }
      })
    };
  }

  static createMockFetch(responses = new Map<string, any>()) {
    return jest.fn().mockImplementation((url: string, options?: any) => {
      const key = `${options?.method || 'GET'} ${url}`;
      
      if (responses.has(key)) {
        const response = responses.get(key);
        if (response instanceof Error) {
          return Promise.reject(response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => response
        });
      }

      // Default responses for common endpoints
      if (url.includes('/forms') && !options?.method) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => this.getMockForms()
        });
      }

      if (url.includes('/entries') && !options?.method) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => this.getMockEntries()
        });
      }

      // Default 404 for unknown endpoints
      return Promise.resolve(this.getMockApiError());
    });
  }
}