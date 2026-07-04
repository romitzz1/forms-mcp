// ABOUTME: Verbatim copy of the original JSON inputSchemas (pre-McpServer migration)
// ABOUTME: Oracle for the toolSchemas faithfulness test — do not edit to match Zod; edit Zod to match this
export const LEGACY_TOOL_SCHEMAS: Record<string, any> = {
  get_forms: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "Optional form ID to get specific form details"
      },
      include_fields: {
        type: "boolean",
        description: "Include full form field details",
        default: false
      },
      include_all: {
        type: "boolean",
        description: "Include all forms (active and inactive) from local cache. If true, performs complete form discovery including hidden/inactive forms.",
        default: false
      },
      exclude_trash: {
        type: "boolean",
        description: "When used with include_all=true, exclude forms marked as trash from results.",
        default: false
      },
      summary_mode: {
        type: "boolean",
        description: "Return only essential form info for large forms to prevent context overflow. Auto-enabled for forms >20k tokens.",
        default: false
      }
    }
  },
  get_entries: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "Form ID to get entries from"
      },
      entry_id: {
        type: "string",
        description: "Specific entry ID to retrieve"
      },
      search: {
        type: "object",
        description: "Search criteria for filtering entries. Example: { \"field_filters\": [{ \"key\": \"1\", \"value\": \"Smith\", \"operator\": \"contains\" }], \"status\": \"active\" }. Operators: is, isnot, contains, >, <, >=, <="
      },
      sorting: {
        type: "object",
        properties: {
          key: { type: "string" },
          direction: { type: "string", enum: ["ASC", "DESC", "RAND"] },
          is_numeric: { type: "boolean" }
        }
      },
      paging: {
        type: "object",
        properties: {
          page_size: { type: "number" },
          current_page: { type: "number" },
          offset: { type: "number" }
        }
      },
      response_mode: {
        type: "string",
        enum: ["full", "summary", "auto"],
        description: "Response format mode: 'full' for complete entries, 'summary' for essential fields only, 'auto' for intelligent size management (default: auto)"
      },
      search_mode: {
        type: "string",
        enum: ["standard", "universal"],
        description: "Search strategy: 'standard' for traditional field-specific search, 'universal' for intelligent multi-field search with auto-detection (default: standard)"
      },
      field_detection: {
        type: "boolean",
        description: "Enable automatic field type detection for better search targeting (default: false)"
      },
      field_ids: {
        type: "array",
        items: { type: "string" },
        description: "Return only these field IDs (plus core entry metadata) instead of every field — greatly reduces response size for wide forms. Requested IDs also include their composite sub-inputs (e.g. \"1\" keeps \"1.3\"/\"1.6\"). Omit or pass an empty array to return all fields. Use get_field_mappings to discover IDs."
      }
    }
  },
  submit_form: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "Form ID to submit to"
      },
      field_values: {
        type: "object",
        description: "Field values as key-value pairs (e.g., 'input_1': 'value')"
      },
      source_page: {
        type: "number",
        description: "Source page number",
        default: 1
      },
      target_page: {
        type: "number",
        description: "Target page number",
        default: 0
      }
    },
    required: ["form_id", "field_values"]
  },
  create_entry: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "Form ID to create entry for"
      },
      field_values: {
        type: "object",
        description: "Field values as key-value pairs"
      },
      entry_meta: {
        type: "object",
        description: "Additional entry metadata"
      }
    },
    required: ["form_id", "field_values"]
  },
  update_entry: {
    type: "object",
    properties: {
      entry_id: {
        type: "string",
        description: "Entry ID to update"
      },
      field_values: {
        type: "object",
        description: "Field values to update"
      }
    },
    required: ["entry_id", "field_values"]
  },
  delete_entry: {
    type: "object",
    properties: {
      entry_id: {
        type: "string",
        description: "Entry ID to delete"
      },
      force: {
        type: "boolean",
        description: "Permanently delete instead of moving to trash",
        default: false
      }
    },
    required: ["entry_id"]
  },
  create_form: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Form title"
      },
      description: {
        type: "string",
        description: "Form description"
      },
      fields: {
        type: "array",
        description: "Array of form fields"
      },
      settings: {
        type: "object",
        description: "Form settings"
      }
    },
    required: ["title"]
  },
  update_form: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "ID of the form to update"
      },
      title: {
        type: "string",
        description: "Updated form title"
      },
      fields: {
        type: "array",
        description: "Updated array of field objects"
      },
      description: {
        type: "string",
        description: "Updated form description"
      },
      settings: {
        type: "object",
        description: "Updated form settings"
      },
      confirmations: {
        type: "object",
        description: "Form confirmations"
      },
      notifications: {
        type: "object",
        description: "Form notifications"
      },
      validate_fields: {
        type: "boolean",
        description: "Validate field types before updating"
      },
      response_format: {
        type: "string",
        enum: ["detailed", "compact", "minimal"],
        description: "Response format (detailed, compact, or minimal)"
      },
      debug: {
        type: "boolean",
        description: "Enable debug logging for troubleshooting"
      }
    },
    required: ["form_id"]
  },
  export_entries_formatted: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "Form ID to export entries from"
      },
      format: {
        type: "string",
        enum: ["csv", "json"],
        description: "Export format"
      },
      search: {
        type: "object",
        description: "Search criteria for filtering entries. Supports multiple date filtering formats for LLM convenience.",
        properties: {
          field_filters: {
            type: "array",
            description: "Filter entries by field values"
          },
          status: {
            type: "string",
            description: "Filter by entry status (active, spam, trash)"
          },
          date_range: {
            type: "object",
            description: "Date range filter (preferred format)",
            properties: {
              start: { type: "string", description: "Start date (YYYY-MM-DD)" },
              end: { type: "string", description: "End date (YYYY-MM-DD)" }
            }
          },
          start_date: {
            type: "string",
            description: "Start date for filtering (LLM-friendly format, YYYY-MM-DD)"
          },
          end_date: {
            type: "string",
            description: "End date for filtering (LLM-friendly format, YYYY-MM-DD)"
          }
        }
      },
      date_format: {
        type: "string",
        description: "Date format for exported dates"
      },
      filename: {
        type: "string",
        description: "Custom filename for export"
      },
      include_headers: {
        type: "boolean",
        description: "Include headers in CSV export",
        default: true
      },
      save_to_disk: {
        type: "boolean",
        description: "Save the exported file to disk",
        default: false
      },
      output_path: {
        type: "string",
        description: "Custom file path for saving (optional, auto-generated if not provided)"
      },
      skip_base64: {
        type: "boolean",
        description: "Skip base64 encoding to reduce response size (useful for large exports)",
        default: false
      },
      field_ids: {
        type: "array",
        description: "Array of Gravity Forms field IDs to include in export (optional). Use string format: [\"1\", \"2\", \"4.3\"]. If provided, only these fields plus metadata will be exported. Use get_field_mappings to discover field IDs.",
        items: {
          type: "string"
        }
      },
      paging: {
        type: "object",
        description: "Pagination settings",
        properties: {
          page_size: { type: "number", description: "Number of entries per page (max 1000)" },
          current_page: { type: "number", description: "Page number to retrieve" }
        }
      }
    },
    required: ["form_id", "format"]
  },
  process_entries_bulk: {
    type: "object",
    properties: {
      entry_ids: {
        type: "array",
        items: { type: "string" },
        description: "Array of entry IDs to process (max 100)",
        maxItems: 100
      },
      operation_type: {
        type: "string",
        enum: ["delete", "update_status", "update_fields"],
        description: "Type of bulk operation to perform"
      },
      confirm: {
        type: "boolean",
        description: "REQUIRED: Must be true to execute destructive operations"
      },
      data: {
        type: "object",
        description: "Data for update operations (required for update_status and update_fields)",
        properties: {
          status: {
            type: "string",
            enum: ["active", "spam", "trash"],
            description: "New status for update_status operations"
          }
        },
        additionalProperties: true
      }
    },
    required: ["entry_ids", "operation_type", "confirm"]
  },
  list_form_templates: {
    type: "object",
    properties: {
      search_term: {
        type: "string",
        description: "Optional search term to filter templates by name or description"
      },
      sort_by: {
        type: "string",
        enum: ["name", "date"],
        description: "Sort templates by name or creation date",
        default: "name"
      },
      sort_order: {
        type: "string",
        enum: ["asc", "desc"],
        description: "Sort order: ascending or descending",
        default: "asc"
      },
      include_all: {
        type: "boolean",
        description: "Include inactive/trashed templates by using local cache. When true, performs complete template discovery including inactive forms. When false (default), uses API-only discovery.",
        default: false
      }
    }
  },
  save_form_as_template: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "ID of the form to convert to a template (required)"
      },
      template_name: {
        type: "string",
        description: "Name for the template (optional - defaults to form title + '-template')"
      }
    },
    required: ["form_id"]
  },
  create_form_from_template: {
    type: "object",
    properties: {
      template_id: {
        type: "string",
        description: "ID of the template form to use as the base (required)"
      },
      new_form_title: {
        type: "string",
        description: "Title for the new form (required)"
      },
      field_renames: {
        type: "array",
        description: "Optional array of field label renames to apply",
        items: {
          type: "object",
          properties: {
            original_label: {
              type: "string",
              description: "Current field label in the template"
            },
            new_label: {
              type: "string",
              description: "New label to assign to the field"
            }
          },
          required: ["original_label", "new_label"]
        }
      }
    },
    required: ["template_id", "new_form_title"]
  },
  export_form_json: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "ID of the form to export (required)"
      }
    },
    required: ["form_id"]
  },
  import_form_json: {
    type: "object",
    properties: {
      form_json: {
        type: "string",
        description: "JSON string containing the form definition to import (required)"
      },
      force_import: {
        type: "boolean",
        description: "Force import and overwrite existing form with same title (optional, default: false)",
        default: false
      },
      use_complete_discovery: {
        type: "boolean",
        description: "Use complete form discovery including inactive forms for conflict detection (optional, default: false)",
        default: false
      }
    },
    required: ["form_json"]
  },
  clone_form_with_modifications: {
    type: "object",
    properties: {
      source_form_id: {
        type: "string",
        description: "ID of the form to clone (required)"
      },
      modifications: {
        type: "object",
        description: "Modifications to apply to the cloned form (optional)",
        properties: {
          title: {
            type: "string",
            description: "New title for the cloned form"
          },
          field_renames: {
            type: "array",
            description: "Array of field label changes",
            items: {
              type: "object",
              properties: {
                original_label: {
                  type: "string",
                  description: "Current field label to change"
                },
                new_label: {
                  type: "string",
                  description: "New label for the field"
                }
              },
              required: ["original_label", "new_label"]
            }
          }
        }
      }
    },
    required: ["source_form_id"]
  },
  get_cache_status: {
    type: "object",
    properties: {},
    required: []
  },
  search_entries_by_name: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "Form ID to search entries in"
      },
      search_text: {
        type: "string",
        description: "Name text to search for"
      },
      strategy: {
        type: "string",
        enum: ["exact", "contains", "fuzzy", "auto"],
        description: "Search strategy to use",
        default: "auto"
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return",
        default: 50
      },
      output_mode: {
        type: "string",
        enum: ["detailed", "summary", "minimal", "auto"],
        description: "Output format mode",
        default: "auto"
      }
    },
    required: ["form_id", "search_text"]
  },
  search_entries_universal: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "Form ID to search entries in"
      },
      search_queries: {
        type: "array",
        description: "Array of search queries with targeting options",
        items: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Search text for this query"
            },
            field_types: {
              type: "array",
              description: "Field types to target (name, email, phone, team)",
              items: { type: "string" }
            },
            field_ids: {
              type: "array",
              description: "Specific field IDs to target (overrides field_types)",
              items: { type: "string" }
            }
          },
          required: ["text"]
        }
      },
      logic: {
        type: "string",
        enum: ["AND", "OR"],
        description: "Logic operator between queries",
        default: "OR"
      },
      strategy: {
        type: "string",
        enum: ["exact", "contains", "fuzzy", "auto"],
        description: "Search strategy to apply to all queries",
        default: "auto"
      },
      filters: {
        type: "object",
        description: "Additional filtering options",
        properties: {
          date_range: {
            type: "object",
            properties: {
              start: { type: "string" },
              end: { type: "string" }
            }
          },
          payment_status: {
            type: "string",
            enum: ["Paid", "Unpaid", "Processing", "Cancelled"]
          }
        }
      },
      output_options: {
        type: "object",
        description: "Output formatting controls",
        properties: {
          mode: {
            type: "string",
            enum: ["detailed", "summary", "minimal", "auto"],
            default: "auto"
          },
          max_results: {
            type: "number",
            description: "Maximum results to return",
            default: 50
          },
          include_field_mappings: {
            type: "boolean",
            description: "Include field mapping information",
            default: false
          }
        }
      }
    },
    required: ["form_id", "search_queries"]
  },
  get_field_mappings: {
    type: "object",
    properties: {
      form_id: {
        type: "string",
        description: "Form ID to analyze field structure for"
      },
      include_details: {
        type: "boolean",
        description: "Include detailed field analysis information",
        default: false
      },
      refresh_cache: {
        type: "boolean",
        description: "Force refresh of cached field mappings",
        default: false
      }
    },
    required: ["form_id"]
  }
};
