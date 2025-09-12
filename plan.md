# TDD Implementation Plan: `update_form` Tool for Gravity Forms MCP Server

## Project Overview
Implement a new `update_form` tool for the Enhanced Gravity Forms MCP Server that allows updating existing forms via the REST API v2. This tool will complete the CRUD operations suite by enabling form modifications through the MCP protocol.

## Architecture Blueprint

### Core Requirements
- **Endpoint**: PUT `/gf/v2/forms/[FORM_ID]`
- **Authentication**: Basic Auth (existing pattern)
- **Required Fields**: `title` and `fields` array
- **Optional Fields**: All other form properties
- **Response**: Updated form object

### Integration Points
1. **index.ts**: Main server class with tool registration and handler
2. **Tool Schema**: Input validation and parameter definition
3. **API Client**: Existing `makeRequest` method for HTTP calls
4. **Error Handling**: McpError class for consistent error responses
5. **Testing**: Jest-based unit tests following existing patterns

## Implementation Breakdown

### Phase 1: Foundation (Infrastructure Setup)
- Create test file structure
- Set up mocks and test utilities
- Define basic test cases for tool registration

### Phase 2: Schema Definition (API Contract)
- Define input schema for update_form tool
- Add parameter validation rules
- Create type definitions if needed

### Phase 3: Core Implementation (Business Logic)
- Implement updateForm method
- Add request building logic
- Handle API response transformation

### Phase 4: Integration (Wire Everything Together)
- Register tool in tools array
- Add case to tool handler switch
- Connect all components

### Phase 5: Error Handling (Robustness)
- Add validation error handling
- Handle API errors gracefully
- Implement retry logic if needed

### Phase 6: Documentation (User Experience)
- Update README with tool documentation
- Add usage examples
- Update CLAUDE.md

## Incremental Implementation Steps

### Step 1: Test File Setup
- Create test file with basic structure
- Import necessary dependencies
- Set up test environment

### Step 2: Tool Registration Test
- Write test for tool appearing in list
- Verify tool metadata is correct
- Check schema validation

### Step 3: Basic Update Test
- Write test for successful form update
- Mock API response
- Verify correct endpoint called

### Step 4: Parameter Validation Tests
- Test missing required parameters
- Test invalid parameter types
- Test boundary conditions

### Step 5: Implement Tool Schema
- Add tool definition to index.ts
- Define input parameters
- Add to tools array

### Step 6: Implement Update Method Stub
- Create updateForm method skeleton
- Add basic parameter extraction
- Return placeholder response

### Step 7: API Request Implementation
- Build request body
- Call makeRequest with PUT method
- Handle response

### Step 8: Error Handling Implementation
- Add try-catch blocks
- Transform API errors to McpError
- Add validation logic

### Step 9: Integration with Tool Handler
- Add case to switch statement
- Call updateForm method
- Test end-to-end flow

### Step 10: Advanced Features
- Add partial updates support
- Implement field validation
- Add response formatting

### Step 11: Documentation Updates
- Update README.md
- Add examples
- Update tool count

### Step 12: Final Integration Testing
- Test with real API (if possible)
- Verify all edge cases
- Ensure backward compatibility

## Test-Driven Development Prompts

### Prompt 1: Test File Foundation ✅ COMPLETED
```text
Create a new test file `__tests__/unit/updateForm.test.ts` for testing the update_form tool in the Gravity Forms MCP Server. The file should:

1. Import necessary testing utilities and mocks from '../mocks/gravityFormsMocks'
2. Set up describe blocks for 'Update Form Tool'
3. Include beforeEach/afterEach hooks for test isolation
4. Mock the fetch API and MCP server components
5. Follow the existing test patterns from gravityFormsMCPServer.test.ts

Start with the basic file structure and imports only. Don't implement any actual tests yet.
```

**Status**: ✅ **COMPLETED** - Test file created with basic structure, proper mocking, and placeholder test to ensure Jest compatibility.

### Prompt 2: Tool Registration Tests ✅ COMPLETED
```text
Add tests to verify the update_form tool is properly registered:

1. Write a test that checks if 'update_form' appears in the list of available tools
2. Verify the tool has the correct description: "Update an existing form"
3. Check that the input schema includes required parameters: form_id, title, fields
4. Verify optional parameters are properly defined

Use the existing pattern from how other tools are tested. Make the tests fail first by not implementing the actual tool yet.
```

**Status**: ✅ **COMPLETED** - Tool registration tests implemented and failing as expected (following TDD). Tests properly capture tool handler through mock implementation and verify tool properties.

### Prompt 3: Basic Update Success Test ✅ COMPLETED
```text
Write a test for successfully updating a form:

1. Create a test that calls the update_form tool with valid parameters
2. Mock the API to return a successful response with the updated form
3. Verify the PUT request is made to the correct endpoint: /forms/{form_id}
4. Check that the request body includes title and fields
5. Assert the response contains the updated form data

The test should fail since the implementation doesn't exist yet.
```

**Status**: ✅ **COMPLETED** - Comprehensive success tests implemented with 4 test cases covering successful update flow, correct endpoint usage, request body validation, and response format verification. All tests failing as expected (TDD).

### Prompt 4: Parameter Validation Tests ✅ COMPLETED
```text
Add comprehensive parameter validation tests:

1. Test that missing form_id throws an InvalidParams error
2. Test that missing title throws an InvalidParams error  
3. Test that missing fields throws an InvalidParams error
4. Test that invalid form_id format is rejected
5. Test that fields must be an array
6. Test that empty title is rejected

Each test should verify the specific error message returned.
```

**Status**: ✅ **COMPLETED** - Comprehensive parameter validation tests implemented with 8 test cases covering missing required parameters, invalid parameter types, empty values, and wrong data types. All tests failing as expected with "Unknown tool: update_form" (TDD).

### Prompt 5: Implement Tool Schema ✅ COMPLETED
```text
In index.ts, add the update_form tool definition to the tools array:

1. Add the tool object with name 'update_form'
2. Set description to "Update an existing form"
3. Define inputSchema with:
   - form_id (required, string): "ID of the form to update"
   - title (required, string): "Updated form title"
   - fields (required, array): "Updated array of field objects"
   - description (optional, string): "Updated form description"
   - Additional optional properties can be included
4. Follow the exact pattern used by create_form tool

Make sure the tool registration tests now pass.
```

**Status**: ✅ **COMPLETED** - Tool schema successfully added to index.ts with proper structure including required parameters (form_id, title, fields) and optional parameters (description, settings). All 5 tool registration tests now passing. Tool ready for implementation.

### Prompt 6: Implement Update Method Stub ✅ COMPLETED
```text
Add a private updateForm method to the GravityFormsMCPServer class:

1. Create method signature: private async updateForm(args: any)
2. Extract parameters: form_id, title, fields, description, and rest
3. For now, just return a success response with mock data
4. Follow the pattern from createForm method
5. Add basic parameter presence checks

This should make the basic update test partially work.
```

**Status**: ✅ **COMPLETED** - updateForm method implemented with comprehensive parameter validation, tool handler integration, and mock response. All 8 parameter validation tests now passing, 5 registration tests passing. Ready for API implementation (Prompt 7).

### Prompt 7: Implement API Request ✅ COMPLETED
```text
Complete the updateForm method implementation:

1. Build the request body with title, fields, and any additional properties
2. Use this.makeRequest with:
   - Endpoint: `/forms/${form_id}`
   - Method: 'PUT'
   - Body: the form update object
3. Return the formatted response following the pattern from createForm
4. Ensure the response includes the success message and updated form data

All basic tests should now pass.
```

**Status**: ✅ **COMPLETED** - Full API implementation with PUT requests to Gravity Forms API. All 17 tests passing (5 registration + 4 success + 8 validation). Complete CRUD operations now available with update_form tool fully functional.

### Prompt 8: Add Error Handling ✅ COMPLETED
```text
Enhance the updateForm method with comprehensive error handling:

1. Add try-catch block around the API call
2. Validate form_id is provided and is a string
3. Validate title is provided and is a non-empty string
4. Validate fields is provided and is an array
5. Transform API errors into McpError with appropriate error codes
6. Add specific error messages for different failure scenarios

The parameter validation tests should all pass now.
```

**Status**: ✅ **COMPLETED** - Error handling already fully implemented. All 17 tests passing with comprehensive parameter validation, API error transformation via makeRequest method, and specific error messages for all validation scenarios.

### Prompt 9: Wire Tool Handler ✅ COMPLETED
```text
Connect the update_form tool to the main tool handler:

1. In the tool handler switch statement, add case 'update_form'
2. Call this.updateForm(args) for this case
3. Return the result from updateForm
4. Ensure proper error propagation

Test the complete flow from tool invocation to response.
```

**Status**: ✅ **COMPLETED** - Tool handler already properly wired with "update_form" case calling this.updateForm(args) at index.ts:960-961. Complete end-to-end flow working.

### Prompt 10: Add Advanced Features ✅ COMPLETED
```text
Enhance the update_form tool with additional capabilities:

1. Support partial updates (only update provided fields)
2. Add field type validation if needed
3. Support updating form settings and notifications
4. Add response formatting options
5. Implement logging for debugging

Write tests for each new feature following TDD principles.
```

**Status**: ✅ **COMPLETED** - All 5 advanced features successfully implemented with comprehensive test coverage! Schema updated to support partial updates (only form_id required), field type validation with 21 valid field types, 3 response formats (detailed/compact/minimal), support for confirmations/notifications, and debug logging with performance timing. 31 tests passing including 14 new advanced feature tests.

### Prompt 11: Update Documentation ✅ COMPLETED
```text
Update the project documentation:

1. In README.md:
   - Add update_form to the tools list
   - Include usage examples
   - Document all parameters
   - Update the total tool count to 17
   
2. In CLAUDE.md:
   - Add update_form to the Core Tools list
   - Note that CRUD operations are now complete
   - Add any implementation notes

3. Create example usage showing form title and field updates
```

**Status**: ✅ **COMPLETED** - Documentation fully updated across README.md, CLAUDE.md, and SETUP.md. Added update_form tool documentation with examples, updated tool counts from 16→17 and 8→9 core tools, corrected Enhanced Tools numbering. CRUD operations now complete.

### Prompt 12: Integration Testing ✅ COMPLETED
```text
Create comprehensive integration tests:

1. Test updating a form with all optional parameters
2. Test updating only specific fields
3. Test error handling for non-existent forms
4. Test concurrent update scenarios
5. Test with various field types and configurations
6. Verify backward compatibility with existing tools

Add any necessary mocks and fixtures for complete test coverage.
```

**Status**: ✅ **COMPLETED** - Comprehensive integration test suite implemented with 43 total tests passing. Added 12 new integration tests covering all 6 requirements: comprehensive form updates with all parameters, partial updates, error handling (404/500/network), concurrent scenarios, field type variations (10+ types), complex field configurations, and full backward compatibility verification with existing tools (create_form, get_forms). Complete test coverage achieved.

## Success Criteria

### Functional Requirements
- [x] Tool appears in list of available tools ✅
- [x] Can update form title and fields ✅
- [x] Supports optional form properties ✅
- [x] Returns updated form data ✅
- [x] Handles errors gracefully ✅

### Technical Requirements
- [x] 100% test coverage for new code ✅
- [x] Follows existing code patterns ✅
- [x] TypeScript compilation without errors ✅
- [x] No breaking changes to existing tools ✅
- [x] Proper error messages and codes ✅

### Documentation Requirements
- [x] README.md updated with examples ✅
- [x] CLAUDE.md reflects new capability ✅
- [x] Input schema fully documented ✅
- [x] Error scenarios documented ✅

## Risk Mitigation

### Potential Issues
1. **Breaking Changes**: Test extensively with existing tools
2. **API Compatibility**: Verify against actual Gravity Forms API
3. **Type Safety**: Use TypeScript strictly
4. **Performance**: Consider caching for repeated updates
5. **Security**: Validate all inputs, sanitize outputs

### Rollback Plan
- Keep changes isolated to new tool
- Maintain backward compatibility
- Feature flag if needed for gradual rollout

## Timeline Estimate

- Phase 1-2 (Foundation & Schema): 30 minutes
- Phase 3-4 (Implementation & Integration): 45 minutes  
- Phase 5 (Error Handling): 30 minutes
- Phase 6 (Documentation): 20 minutes
- Testing & Refinement: 35 minutes

**Total Estimated Time**: ~2.5-3 hours for complete implementation

## Notes

This plan follows TDD principles strictly:
1. Write tests first
2. See them fail
3. Implement minimum code to pass
4. Refactor if needed
5. Repeat

Each prompt builds on the previous one, ensuring no orphaned code and complete integration at each step.