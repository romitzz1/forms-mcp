# TDD Implementation Plan: Enhanced Gravity Forms MCP Server

## Project Overview

We are enhancing an existing Gravity Forms MCP (Model Context Protocol) server with advanced features including entry export, bulk operations, template management, and form import/export capabilities. The current server has 8 basic tools for form interaction and needs 8 additional tools.

## Current State Analysis

**Existing Tools:**

- `get_forms` - Retrieve form definitions and metadata
- `get_entries` - Query form entries with filtering/pagination  
- `submit_form` - Submit forms with full processing
- `create_entry` - Create entries directly (bypasses form processing)
- `update_entry` - Update existing entries
- `delete_entry` - Delete/trash entries
- `create_form` - Create new forms programmatically
- `validate_form` - Validate submissions without saving

**Current Architecture:**

- Single TypeScript file (`index.ts`) with `GravityFormsMCPServer` class
- Uses `@modelcontextprotocol/sdk` for MCP protocol handling
- Basic authentication with WordPress REST API
- Environment-based configuration
- No testing framework currently implemented

## New Features to Implement

### 1. Entry Export Tools

- `export_entries_formatted` - Export to CSV/JSON with advanced formatting

### 2. Bulk Operations Tools

- `process_entries_bulk` - Bulk update/delete operations with confirmation

### 3. Template Management Tools

- `list_form_templates` - Browse available templates (forms with `-template` suffix)
- `create_form_from_template` - Create forms from templates with customizations
- `save_form_as_template` - Save existing forms as reusable templates
- `clone_form_with_modifications` - Clone forms with intelligent modifications

### 4. Import/Export Tools

- `export_form_json` - Export form definition as JSON
- `import_form_json` - Import form from JSON with conflict handling

## Technical Requirements

### Testing Strategy

- Use Jest for unit and integration testing
- Mock Gravity Forms API responses
- Test each tool independently
- Test error handling and edge cases
- Test template workflow end-to-end

### Safety Requirements

- Bulk operations require explicit confirmation
- Template field type validation (prevent unsafe type changes)
- Import conflict detection with override option
- Proper error handling and rollback capabilities

### Code Quality

- TypeScript strict mode
- Comprehensive error handling
- Input validation for all tools
- Clean separation of concerns
- Consistent code style

## Implementation Phases

### Phase 1: Foundation Setup

- Set up testing infrastructure (Jest + TypeScript)
- Create utility functions for common operations
- Implement CSV/JSON export utilities
- Add input validation helpers

### Phase 2: Entry Export

- Implement `export_entries_formatted` tool
- Support CSV and JSON formats
- Handle complex field types and nested data
- Test with various entry data structures

### Phase 3: Bulk Operations

- Implement `process_entries_bulk` tool
- Add confirmation mechanisms
- Support multiple operation types (delete, update, reassign)
- Implement safety limits and validation

### Phase 4: Template Management Foundation

- Implement `list_form_templates` tool
- Add template identification logic (forms with `-template` suffix)
- Create form cloning utilities
- Add field validation and modification helpers

### Phase 5: Template Operations

- Implement `save_form_as_template` tool
- Implement `create_form_from_template` tool
- Implement `clone_form_with_modifications` tool
- Add field renaming and validation logic

### Phase 6: Import/Export

- Implement `export_form_json` tool
- Implement `import_form_json` tool
- Add conflict detection and resolution
- Handle form ID mapping and references

### Phase 7: Integration & Polish

- Integration testing across all tools
- Performance optimization
- Documentation updates
- Final error handling review

## Success Criteria

1. All 8 new tools implemented and tested
2. Comprehensive test coverage (>90%)
3. All safety mechanisms working correctly
4. Template workflow fully functional
5. Export/import preserves form integrity
6. Bulk operations work reliably with confirmation
7. Code maintains existing patterns and style
8. No breaking changes to existing functionality

## Risk Mitigation

1. **API Changes**: Mock all external API calls for testing
2. **Data Loss**: Implement confirmation for destructive operations
3. **Type Safety**: Use TypeScript strict mode and comprehensive interfaces
4. **Template Corruption**: Validate field types and structures before modifications
5. **Performance**: Implement reasonable limits on bulk operations
6. **Security**: Validate all inputs and sanitize data before API calls

## Detailed Implementation Steps

This plan is broken down into small, iterative chunks designed for Test-Driven Development. Each step builds on the previous ones and includes comprehensive testing.

### Step 1: Setup Testing Infrastructure

**Goal**: Set up Jest testing framework with TypeScript support and create initial test structure.

**TDD Prompt**:
```
Set up a comprehensive testing environment for the Gravity Forms MCP server. You need to:

1. Add Jest and necessary TypeScript testing dependencies to package.json
2. Create a jest.config.js file with TypeScript support and proper module resolution
3. Add test scripts to package.json (test, test:watch, test:coverage)
4. Create a __tests__ directory structure
5. Create a basic test file that verifies the existing GravityFormsMCPServer class can be instantiated
6. Create mock utilities for Gravity Forms API responses
7. Ensure all tests pass and TypeScript compilation works

Write tests first, then implement the minimal configuration needed to make them pass. The testing setup should support both unit tests and integration tests.
```

### Step 2: Create Data Export Utilities

**Goal**: Build reusable utilities for converting Gravity Forms entry data to CSV and JSON formats.

**TDD Prompt**:
```
Create data export utilities for the Gravity Forms MCP server using Test-Driven Development:

1. Write tests for a DataExporter class that can:
   - Convert entry arrays to CSV format with proper headers
   - Convert entry arrays to JSON format with clean structure
   - Handle complex field types (name fields, address fields, file uploads)
   - Handle missing or null values gracefully
   - Support custom date formatting
   - Return data as base64 encoded strings for file download

2. Create interfaces for:
   - ExportFormat ('csv' | 'json')
   - ExportOptions (dateFormat, includeHeaders, etc.)
   - ExportResult (data, filename, mimeType)

3. Implement the DataExporter class to make all tests pass
4. Test edge cases: empty data, malformed entries, special characters

The implementation should be in a separate utils/dataExporter.ts file and follow existing code patterns.
```

### Step 3: Add Input Validation Utilities

**Goal**: Create comprehensive input validation for all tool parameters.

**TDD Prompt**:
```
Create input validation utilities using TDD approach:

1. Write tests for a ValidationHelper class that validates:
   - Form IDs (non-empty strings, numeric format)
   - Entry IDs (arrays and single values)
   - Export formats and options
   - Bulk operation parameters
   - Field modification parameters for templates

2. Create validation schemas using TypeScript interfaces for:
   - ExportEntriesParams
   - BulkProcessParams  
   - TemplateParams
   - ImportExportParams

3. Implement validation methods that:
   - Return clear error messages for invalid inputs
   - Sanitize inputs to prevent injection attacks
   - Validate required vs optional parameters
   - Check parameter combinations for logical consistency

4. Write tests for edge cases and security scenarios

Place implementation in utils/validation.ts and ensure it integrates with existing error handling patterns.
```

### Step 4: Implement Export Entries Tool

**Goal**: Add the export_entries_formatted tool with full CSV/JSON export capability.

**TDD Prompt**:
```
Implement the export_entries_formatted tool using TDD:

1. Write tests that verify the tool can:
   - Export entries from a specific form in CSV format
   - Export entries in JSON format with proper structure
   - Handle pagination for large datasets
   - Apply search filters before export
   - Include proper headers and metadata
   - Handle various field types (text, email, name, address, file uploads)
   - Return base64 encoded data for download

2. Add the tool definition to the ListToolsRequestSchema response
3. Implement the tool handler in the CallToolRequestSchema handler
4. Use the DataExporter utility created in Step 2
5. Use the ValidationHelper from Step 3 for input validation
6. Mock all API calls to Gravity Forms in tests
7. Test error scenarios: invalid form ID, no entries, API failures

The tool should accept parameters: form_id, format ('csv'|'json'), search filters, date_format, and pagination options. Follow existing tool patterns in the codebase.
```

### Step 5: Implement Bulk Operations Foundation

**Goal**: Create the framework for safe bulk operations with confirmation mechanisms.

**TDD Prompt**:
```
Create the foundation for bulk operations using TDD:

1. Write tests for a BulkOperationsManager class that:
   - Validates bulk operation requests (max 100 entries)
   - Requires explicit confirmation parameter
   - Supports operation types: delete, update_status, update_fields
   - Provides operation previews before execution
   - Tracks success/failure counts
   - Implements rollback capabilities where possible

2. Create interfaces for:
   - BulkOperationType ('delete' | 'update_status' | 'update_fields')
   - BulkOperationParams (entry_ids, operation, confirmation, data)
   - BulkOperationResult (processed, successful, failed, errors)

3. Implement the BulkOperationsManager to make tests pass
4. Test safety mechanisms: no confirmation, too many entries, invalid operations
5. Mock API responses for testing different scenarios

Place in utils/bulkOperations.ts. Ensure proper error handling and logging for audit trails.
```

### Step 6: Implement Process Entries Bulk Tool

**Goal**: Add the process_entries_bulk tool with full safety mechanisms.

**TDD Prompt**:
```
Implement the process_entries_bulk tool using TDD:

1. Write tests that verify the tool can:
   - Delete multiple entries with confirmation
   - Update entry status (active, spam, trash) for multiple entries
   - Update specific field values across multiple entries
   - Refuse operations without explicit confirm: true parameter
   - Return detailed results with success/failure counts
   - Handle partial failures gracefully
   - Respect the 100 entry limit

2. Add the tool definition with clear warning about destructive operations
3. Implement the tool handler using BulkOperationsManager from Step 5
4. Test all operation types with mocked API responses
5. Test safety mechanisms: missing confirmation, oversized requests
6. Test error recovery: API failures, network issues, invalid entry IDs

The tool should require: entry_ids[], operation_type, confirm: true, and optional data for update operations. Include clear warnings in the tool description.
```

### Step 7: Implement Template Identification

**Goal**: Create utilities to identify and work with form templates.

**TDD Prompt**:
```
Create template identification utilities using TDD:

1. Write tests for a TemplateManager class that:
   - Identifies forms with '-template' suffix as templates
   - Filters template list from all forms
   - Validates template form structure
   - Checks if form names would conflict when creating from template
   - Generates safe template names from existing forms

2. Create interfaces for:
   - FormTemplate (extends base form with template metadata)
   - TemplateInfo (id, name, description, field_count, created_date)
   - TemplateCreateOptions (new_name, field_renames)

3. Implement TemplateManager methods:
   - listTemplates(): Promise<TemplateInfo[]>
   - isTemplate(form): boolean  
   - generateTemplateName(baseName): string
   - validateTemplateStructure(form): boolean

4. Test with various form data including edge cases
5. Mock API responses for form listing

Place in utils/templateManager.ts and ensure it works with existing API patterns.
```

### Step 8: Implement List Form Templates Tool

**Goal**: Add the list_form_templates tool to browse available templates.

**TDD Prompt**:
```
Implement the list_form_templates tool using TDD:

1. Write tests that verify the tool can:
   - List all forms with '-template' suffix
   - Return template metadata (name, description, field count)
   - Filter templates by search criteria
   - Sort templates by name or creation date
   - Handle cases where no templates exist
   - Include field summary information

2. Add the tool definition to the tools list
3. Implement the tool handler using TemplateManager from Step 7
4. Test with various template scenarios
5. Test error handling: API failures, malformed template data

The tool should accept optional parameters: search_term, sort_by ('name'|'date'), sort_order ('asc'|'desc'). Return clean template information suitable for user selection.
```

### Step 9: Implement Template Creation Utilities

**Goal**: Create utilities for safely modifying form templates.

**TDD Prompt**:
```
Create template creation utilities using TDD:

1. Write tests for a TemplateCreator class that:
   - Clones form structure from templates
   - Safely renames field labels (strings only)
   - Validates field type compatibility
   - Prevents dangerous field type changes (date->text, etc.)
   - Updates form title and removes '-template' suffix
   - Preserves conditional logic and calculations
   - Handles field dependencies correctly

2. Create interfaces for:
   - FieldRename (original_label, new_label)
   - TemplateModification (title, field_renames, preserve_logic)
   - ModificationResult (success, warnings, errors)

3. Implement methods:
   - cloneFromTemplate(templateId, modifications): Promise<FormData>
   - validateFieldRenames(template, renames): ModificationResult
   - applyFieldRenames(form, renames): FormData

4. Test field type safety: prevent birthday->phone, allow color->animal
5. Test complex forms with conditional logic

Place in utils/templateCreator.ts with comprehensive field type validation.
```

### Step 10: Implement Save Form as Template Tool

**Goal**: Add the save_form_as_template tool to create reusable templates.

**TDD Prompt**:
```
Implement the save_form_as_template tool using TDD:

1. Write tests that verify the tool can:
   - Clone an existing form with '-template' suffix added
   - Remove form-specific data (entries, notifications)
   - Preserve form structure and field definitions
   - Handle name conflicts with existing templates
   - Validate source form exists and is accessible
   - Set appropriate template metadata

2. Add the tool definition with clear description
3. Implement using TemplateManager and existing API methods
4. Test with various form types and complexities
5. Test error cases: missing source form, name conflicts, API failures

The tool should accept: form_id (required), template_name (optional - defaults to form title + '-template'). Return the created template information.
```

### Step 11: Implement Create Form from Template Tool

**Goal**: Add the create_form_from_template tool with field customization.

**TDD Prompt**:
```
Implement the create_form_from_template tool using TDD:

1. Write tests that verify the tool can:
   - Create new forms from existing templates
   - Apply field label renames safely
   - Preserve field types and validation rules
   - Update form title and metadata
   - Handle field dependency updates
   - Validate all modifications before applying

2. Use TemplateCreator from Step 9 for safe modifications
3. Test field renaming scenarios: safe (color->animal) and unsafe (date->phone)
4. Test complex templates with conditional logic
5. Test error handling: missing template, invalid modifications

The tool should accept: template_id, new_form_title, field_renames (optional array of {original_label, new_label}). Return the created form information.
```

### Step 12: Implement Form JSON Export Tool

**Goal**: Add the export_form_json tool for form definition export.

**TDD Prompt**:
```
Implement the export_form_json tool using TDD:

1. Write tests that verify the tool can:
   - Export complete form definition as JSON
   - Include all fields, settings, and configuration
   - Preserve conditional logic and calculations
   - Remove sensitive data (API keys, private settings)
   - Format JSON for readability and import compatibility
   - Handle forms with complex field types

2. Add the tool definition
3. Implement using existing API patterns
4. Test with various form complexities
5. Test error handling: missing form, permission issues

The tool should accept: form_id (required). Return the form JSON as a formatted string that can be imported later.
```

### Step 13: Implement Form JSON Import Tool

**Goal**: Add the import_form_json tool with conflict resolution.

**TDD Prompt**:
```
Implement the import_form_json tool using TDD:

1. Write tests that verify the tool can:
   - Import form definitions from JSON
   - Handle form ID conflicts with existing forms
   - Validate JSON structure before import
   - Support force_import flag for overwriting
   - Assign new IDs when conflicts occur
   - Preserve form integrity during import

2. Create FormImporter utility class for:
   - JSON validation and parsing
   - Conflict detection and resolution
   - ID mapping and reference updates
   - Import result reporting

3. Test scenarios: new import, conflicting IDs, malformed JSON, partial failures
4. Test with force_import flag behavior

The tool should accept: form_json (required), force_import (optional boolean). Return import results with any ID mappings or conflicts resolved.
```

### Step 14: Implement Clone with Modifications Tool

**Goal**: Add the clone_form_with_modifications tool for intelligent form cloning.

**TDD Prompt**:
```
Implement the clone_form_with_modifications tool using TDD:

1. Write tests that verify the tool can:
   - Clone existing forms with modifications
   - Apply field label changes
   - Update form title and metadata
   - Preserve or modify conditional logic
   - Handle field dependencies correctly
   - Validate all modifications for safety

2. Combine utilities from previous steps (TemplateCreator, validation)
3. Test complex modification scenarios
4. Test with forms containing advanced features
5. Test error handling and rollback scenarios

The tool should accept: source_form_id, modifications (title, field_renames, etc.). Return the cloned form information.
```

### Step 15: Integration Testing and Polish

**Goal**: Comprehensive testing of all tools working together and final polish.

**TDD Prompt**:
```
Create comprehensive integration tests and polish the implementation:

1. Write integration tests that verify:
   - Complete template workflow: create template, list templates, create from template
   - Export/import round-trip: export form JSON, import to new form
   - Bulk operations with various data sets
   - Error handling across all tools
   - Tool interactions and dependencies

2. Performance testing:
   - Large data export operations
   - Bulk operations with maximum entries
   - Template operations with complex forms

3. Polish and cleanup:
   - Consistent error messages across all tools
   - Proper input validation everywhere
   - Clean up any remaining TODO comments
   - Ensure TypeScript strict mode compliance
   - Update tool descriptions for clarity

4. Final verification:
   - All 8 new tools working correctly
   - No breaking changes to existing functionality
   - Comprehensive test coverage
   - Code follows existing patterns

Run full test suite and ensure all tests pass. Verify the server can start and all tools are properly registered.
```

## TDD Prompt Summary

Each step above provides a complete TDD prompt that builds incrementally on previous work. The prompts emphasize:

- Writing tests first
- Implementing minimal code to pass tests
- Building reusable utilities
- Maintaining safety and security
- Following existing code patterns
- Comprehensive error handling
- Progressive complexity building

The implementation should result in a robust, well-tested enhancement to the Gravity Forms MCP server with all 8 new tools functioning correctly.