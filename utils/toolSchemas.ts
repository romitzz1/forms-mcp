// ABOUTME: Zod input schemas + descriptions for all 20 MCP tools (McpServer registerTool)
// ABOUTME: Faithful conversion of the original JSON inputSchemas; verified by toolSchemas.test.ts
import { z } from "zod";

export const TOOL_SCHEMAS: Record<string, { description: string; inputSchema: z.ZodRawShape }> = {
  get_forms: {
    description: "Get all forms or specific form details",
    inputSchema: {
      form_id: z.string().describe("Optional form ID to get specific form details").optional(),
      include_fields: z.boolean().describe("Include full form field details").default(false),
      include_all: z
        .boolean()
        .describe(
          "Include all forms (active and inactive) from local cache. If true, performs complete form discovery including hidden/inactive forms."
        )
        .default(false),
      exclude_trash: z
        .boolean()
        .describe("When used with include_all=true, exclude forms marked as trash from results.")
        .default(false),
      summary_mode: z
        .boolean()
        .describe(
          "Return only essential form info for large forms to prevent context overflow. Auto-enabled for forms >20k tokens."
        )
        .default(false),
      sort_by: z
        .enum(["id", "title", "entry_count", "date_created"] as [string, ...string[]])
        .describe(
          "When used with include_all=true, sort forms by this field. 'id' and 'date_created' both order by recency (highest/newest first when sort_order=desc)."
        )
        .optional(),
      sort_order: z
        .enum(["asc", "desc"] as [string, ...string[]])
        .describe("Sort direction for sort_by. Defaults to 'desc' (newest/highest first).")
        .default("desc"),
      active_only: z
        .boolean()
        .describe("When used with include_all=true, return only active (non-inactive) forms.")
        .default(false),
    },
  },

  get_entries: {
    description: "Get entries from forms with filtering and pagination",
    inputSchema: {
      form_id: z.string().describe("Form ID to get entries from").optional(),
      entry_id: z.string().describe("Specific entry ID to retrieve").optional(),
      search: z
        .record(z.string(), z.unknown())
        .describe(
          'Search criteria for filtering entries. Example: { "field_filters": [{ "key": "1", "value": "Smith", "operator": "contains" }], "status": "active" }. Operators: is, isnot, contains, >, <, >=, <='
        )
        .optional(),
      sorting: z
        .object({
          key: z.string().optional(),
          direction: z.enum(["ASC", "DESC", "RAND"] as [string, ...string[]]).optional(),
          is_numeric: z.boolean().optional(),
        })
        .optional(),
      paging: z
        .object({
          page_size: z.number().optional(),
          current_page: z.number().optional(),
          offset: z.number().optional(),
        })
        .optional(),
      response_mode: z
        .enum(["full", "summary", "auto"] as [string, ...string[]])
        .describe(
          "Response format mode: 'full' for complete entries, 'summary' to keep every populated field but truncate individually oversized values (truncated keys are listed under each entry's _summary), 'auto' for intelligent size management (default: auto)"
        )
        .optional(),
      search_mode: z
        .enum(["standard", "universal"] as [string, ...string[]])
        .describe(
          "Search strategy: 'standard' for traditional field-specific search, 'universal' for intelligent multi-field search with auto-detection (default: standard)"
        )
        .optional(),
      field_detection: z
        .boolean()
        .describe("Enable automatic field type detection for better search targeting (default: false)")
        .optional(),
      field_ids: z
        .array(z.string())
        .describe("Return only these field IDs (plus core entry metadata) instead of every field — greatly reduces response size for wide forms. Requested IDs also include their composite sub-inputs (e.g. \"1\" keeps \"1.3\"/\"1.6\"). Omit or pass an empty array to return all fields. Use get_field_mappings to discover IDs.")
        .optional(),
      exclude_empty: z
        .boolean()
        .describe("Drop abandoned submissions — entries whose every field value is empty — from the results. Filtering happens after fetch, so pagination totals still reflect the server's unfiltered count.")
        .default(false),
    },
  },

  aggregate_entries: {
    description: "Tally field-value distributions across a form's entries — one call to summarize a survey. Returns value→count for each requested field.",
    inputSchema: {
      form_id: z.string().describe("Form ID whose entries to aggregate"),
      field_ids: z
        .array(z.string())
        .describe("Field IDs to tally (use get_field_mappings to discover them). Checkbox/multi-select fields tally each selected option across their sub-inputs (e.g. \"12\" covers \"12.1\", \"12.2\")."),
      search: z
        .record(z.string(), z.unknown())
        .describe('Optional filter, same shape as get_entries: { "status": "active", "field_filters": [{ "key": "1", "value": "X", "operator": "is" }] }.')
        .optional(),
      max_entries: z
        .number()
        .describe("Maximum number of entries to scan (default 1000). Aggregation pages through entries up to this cap; a note flags when the cap is hit.")
        .default(1000),
      top: z
        .number()
        .describe("Return only the N most frequent values per field. Omit to return all distinct values.")
        .optional(),
    },
  },

  submit_form: {
    description: "Submit a form with field values",
    inputSchema: {
      form_id: z.string().describe("Form ID to submit to"),
      field_values: z.record(z.string(), z.unknown()).describe("Field values as key-value pairs (e.g., 'input_1': 'value')"),
      source_page: z.number().describe("Source page number").default(1),
      target_page: z.number().describe("Target page number").default(0),
    },
  },

  create_entry: {
    description: "Create a new entry directly (bypasses form validation)",
    inputSchema: {
      form_id: z.string().describe("Form ID to create entry for"),
      field_values: z.record(z.string(), z.unknown()).describe("Field values as key-value pairs"),
      entry_meta: z.record(z.string(), z.unknown()).describe("Additional entry metadata").optional(),
    },
  },

  update_entry: {
    description: "Update an existing entry",
    inputSchema: {
      entry_id: z.string().describe("Entry ID to update"),
      field_values: z.record(z.string(), z.unknown()).describe("Field values to update"),
    },
  },

  delete_entry: {
    description: "Delete an entry (moves to trash by default)",
    inputSchema: {
      entry_id: z.string().describe("Entry ID to delete"),
      force: z.boolean().describe("Permanently delete instead of moving to trash").default(false),
    },
  },

  create_form: {
    description: "Create a new form",
    inputSchema: {
      title: z.string().describe("Form title"),
      description: z.string().describe("Form description").optional(),
      fields: z.array(z.unknown()).describe("Array of form fields").optional(),
      settings: z.record(z.string(), z.unknown()).describe("Form settings").optional(),
    },
  },

  update_form: {
    description: "Replace an existing form with a full form definition. Both title and fields are required — the form is fully replaced, so any fields omitted from the payload will be removed.",
    inputSchema: {
      form_id: z.string().describe("ID of the form to update"),
      title: z.string().describe("Updated form title").optional(),
      fields: z.array(z.unknown()).describe("Updated array of field objects").optional(),
      description: z.string().describe("Updated form description").optional(),
      settings: z.record(z.string(), z.unknown()).describe("Updated form settings").optional(),
      confirmations: z.record(z.string(), z.unknown()).describe("Form confirmations").optional(),
      notifications: z.record(z.string(), z.unknown()).describe("Form notifications").optional(),
      validate_fields: z.boolean().describe("Validate field types before updating").optional(),
      response_format: z
        .enum(["detailed", "compact", "minimal"] as [string, ...string[]])
        .describe("Response format (detailed, compact, or minimal)")
        .optional(),
      debug: z.boolean().describe("Enable debug logging for troubleshooting").optional(),
    },
  },

  export_entries_formatted: {
    description: "Export entries from a form in CSV or JSON format with advanced formatting options",
    inputSchema: {
      form_id: z.string().describe("Form ID to export entries from"),
      format: z.enum(["csv", "json"] as [string, ...string[]]).describe("Export format"),
      search: z
        .object({
          field_filters: z.array(z.unknown()).describe("Filter entries by field values").optional(),
          status: z.string().describe("Filter by entry status (active, spam, trash)").optional(),
          date_range: z
            .object({
              start: z.string().describe("Start date (YYYY-MM-DD)").optional(),
              end: z.string().describe("End date (YYYY-MM-DD)").optional(),
            })
            .describe("Date range filter (preferred format)")
            .optional(),
          start_date: z.string().describe("Start date for filtering (LLM-friendly format, YYYY-MM-DD)").optional(),
          end_date: z.string().describe("End date for filtering (LLM-friendly format, YYYY-MM-DD)").optional(),
        })
        .describe("Search criteria for filtering entries. Supports multiple date filtering formats for LLM convenience.")
        .optional(),
      date_format: z.string().describe("Date format for exported dates").optional(),
      filename: z.string().describe("Custom filename for export").optional(),
      include_headers: z.boolean().describe("Include headers in CSV export").default(true),
      save_to_disk: z.boolean().describe("Save the exported file to disk").default(false),
      output_path: z.string().describe("Custom file path for saving (optional, auto-generated if not provided)").optional(),
      skip_base64: z
        .boolean()
        .describe("Skip base64 encoding to reduce response size (useful for large exports)")
        .default(false),
      field_ids: z
        .array(z.string())
        .describe(
          'Array of Gravity Forms field IDs to include in export (optional). Use string format: ["1", "2", "4.3"]. If provided, only these fields plus metadata will be exported. Use get_field_mappings to discover field IDs.'
        )
        .optional(),
      paging: z
        .object({
          page_size: z.number().describe("Number of entries per page (max 1000)").optional(),
          current_page: z.number().describe("Page number to retrieve").optional(),
        })
        .describe("Pagination settings")
        .optional(),
    },
  },

  process_entries_bulk: {
    description:
      "⚠️  WARNING: DESTRUCTIVE OPERATION ⚠️\n\nPerform bulk operations on multiple entries (delete, update status, update fields). This operation can permanently modify or delete large numbers of entries. ALWAYS confirm operations with 'confirm: true' parameter. Supports up to 100 entries per operation for safety.\n\nOperations:\n- delete: Permanently delete entries (CANNOT be undone)\n- update_status: Change entry status (active, spam, trash)\n- update_fields: Update specific field values\n\nSafety features: confirmation required, operation limits, rollback data for updates, audit trails.",
    inputSchema: {
      entry_ids: z.array(z.string()).describe("Array of entry IDs to process (max 100)").max(100),
      operation_type: z
        .enum(["delete", "update_status", "update_fields"] as [string, ...string[]])
        .describe("Type of bulk operation to perform"),
      confirm: z.boolean().describe("REQUIRED: Must be true to execute destructive operations"),
      data: z
        .object({
          status: z
            .enum(["active", "spam", "trash"] as [string, ...string[]])
            .describe("New status for update_status operations")
            .optional(),
        })
        .catchall(z.unknown())
        .describe("Data for update operations (required for update_status and update_fields)")
        .optional(),
    },
  },

  list_form_templates: {
    description:
      "List all available form templates (forms with '-template' suffix). Returns template metadata including name, description, field count, and creation date. Supports optional filtering by search term and sorting by name or creation date.",
    inputSchema: {
      search_term: z.string().describe("Optional search term to filter templates by name or description").optional(),
      sort_by: z
        .enum(["name", "date"] as [string, ...string[]])
        .describe("Sort templates by name or creation date")
        .default("name"),
      sort_order: z
        .enum(["asc", "desc"] as [string, ...string[]])
        .describe("Sort order: ascending or descending")
        .default("asc"),
      include_all: z
        .boolean()
        .describe(
          "Include inactive/trashed templates by using local cache. When true, performs complete template discovery including inactive forms. When false (default), uses API-only discovery."
        )
        .default(false),
    },
  },

  save_form_as_template: {
    description:
      "Save an existing form as a reusable template. Clones the form structure while removing form-specific data like entries and notifications. The template can then be used to create new forms with similar structure.",
    inputSchema: {
      form_id: z.string().describe("ID of the form to convert to a template (required)"),
      template_name: z.string().describe("Name for the template (optional - defaults to form title + '-template')").optional(),
    },
  },

  create_form_from_template: {
    description:
      "Create a new form from an existing template with optional field customizations. Supports safe field label renames while preserving field types, validation rules, and conditional logic. Dangerous field type changes (e.g., date->phone) are prevented for data integrity.",
    inputSchema: {
      template_id: z.string().describe("ID of the template form to use as the base (required)"),
      new_form_title: z.string().describe("Title for the new form (required)"),
      field_renames: z
        .array(
          z.object({
            original_label: z.string().describe("Current field label in the template"),
            new_label: z.string().describe("New label to assign to the field"),
          })
        )
        .describe("Optional array of field label renames to apply")
        .optional(),
    },
  },

  export_form_json: {
    description:
      "Export a complete form definition as JSON for backup, migration, or import purposes. Removes sensitive data (API keys, private settings) while preserving all form structure, fields, conditional logic, and calculations. Always writes the JSON to disk and returns the file path plus a summary (never inlines the full definition, which can overflow context).",
    inputSchema: {
      form_id: z.string().describe("ID of the form to export (required)"),
      filename: z
        .string()
        .describe("Optional output filename. Defaults to form-{form_id}-{title-slug}.json.")
        .optional(),
      output_path: z
        .string()
        .describe("Optional path (absolute, or relative to the working directory) to write the export to. Defaults to the configured export directory (GRAVITY_FORMS_EXPORT_DIR), organized by form ID and date.")
        .optional(),
    },
  },

  import_form_json: {
    description:
      "Import a form definition from JSON with automatic conflict resolution. Handles form ID conflicts, validates JSON structure, supports force import to overwrite existing forms. Maps field IDs and updates references (conditional logic, calculations) to maintain form integrity. Supports complete discovery to check conflicts against both active and inactive forms.",
    inputSchema: {
      form_json: z.string().describe("JSON string containing the form definition to import (required)"),
      force_import: z
        .boolean()
        .describe("Force import and overwrite existing form with same title (optional, default: false)")
        .default(false),
      use_complete_discovery: z
        .boolean()
        .describe("Use complete form discovery including inactive forms for conflict detection (optional, default: false)")
        .default(false),
    },
  },

  clone_form_with_modifications: {
    description:
      "Clone an existing form with intelligent modifications including title changes and field label updates. Preserves form structure, conditional logic, and calculations while safely applying modifications. Automatically updates field references in formulas and conditional logic.",
    inputSchema: {
      source_form_id: z.string().describe("ID of the form to clone (required)"),
      modifications: z
        .object({
          title: z.string().describe("New title for the cloned form").optional(),
          field_renames: z
            .array(
              z.object({
                original_label: z.string().describe("Current field label to change"),
                new_label: z.string().describe("New label for the field"),
              })
            )
            .describe("Array of field label changes")
            .optional(),
        })
        .describe("Modifications to apply to the cloned form (optional)")
        .optional(),
    },
  },

  get_cache_status: {
    description:
      "Get comprehensive FormCache status and statistics for monitoring and debugging. Shows cache health, configuration, form counts, and last sync information.",
    inputSchema: {},
  },

  search_entries_by_name: {
    description: "Search form entries by name across all name fields automatically",
    inputSchema: {
      form_id: z.string().describe("Form ID to search entries in"),
      search_text: z.string().describe("Name text to search for"),
      strategy: z
        .enum(["exact", "contains", "fuzzy", "auto"] as [string, ...string[]])
        .describe("Search strategy to use")
        .default("auto"),
      max_results: z.number().describe("Maximum number of results to return").default(50),
      output_mode: z
        .enum(["detailed", "summary", "minimal", "auto"] as [string, ...string[]])
        .describe("Output format mode")
        .default("auto"),
    },
  },

  search_entries_universal: {
    description:
      "Advanced multi-field search across name, email, phone, and custom fields with AND/OR logic. Use this for cross-field searches (e.g., name AND email), specific field ID targeting, or when search_entries_by_name is too limited. Use get_field_mappings first to discover field IDs for targeted searches.",
    inputSchema: {
      form_id: z.string().describe("Form ID to search entries in"),
      search_queries: z
        .array(
          z.object({
            text: z.string().describe("Search text for this query"),
            field_types: z.array(z.string()).describe("Field types to target (name, email, phone, team)").optional(),
            field_ids: z.array(z.string()).describe("Specific field IDs to target (overrides field_types)").optional(),
          })
        )
        .describe("Array of search queries with targeting options"),
      logic: z.enum(["AND", "OR"] as [string, ...string[]]).describe("Logic operator between queries").default("OR"),
      strategy: z
        .enum(["exact", "contains", "fuzzy", "auto"] as [string, ...string[]])
        .describe("Search strategy to apply to all queries")
        .default("auto"),
      filters: z
        .object({
          date_range: z
            .object({
              start: z.string().optional(),
              end: z.string().optional(),
            })
            .optional(),
          payment_status: z.enum(["Paid", "Unpaid", "Processing", "Cancelled"] as [string, ...string[]]).optional(),
        })
        .describe("Additional filtering options")
        .optional(),
      output_options: z
        .object({
          mode: z.enum(["detailed", "summary", "minimal", "auto"] as [string, ...string[]]).default("auto"),
          max_results: z.number().describe("Maximum results to return").default(50),
          include_field_mappings: z.boolean().describe("Include field mapping information").default(false),
        })
        .describe("Output formatting controls")
        .optional(),
    },
  },

  get_field_mappings: {
    description:
      "Analyze a form's field structure and detect field types (name, email, phone, address). Call this before search_entries_universal to discover which field IDs to target for accurate search results.",
    inputSchema: {
      form_id: z.string().describe("Form ID to analyze field structure for"),
      include_details: z.boolean().describe("Include detailed field analysis information").default(false),
      refresh_cache: z.boolean().describe("Force refresh of cached field mappings").default(false),
    },
  },
};
