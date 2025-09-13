# TDD Implementation Plan: Fix Gravity Forms Field Update Issue

## Project Overview
Fix the `update_form` tool in the Gravity Forms MCP server to properly handle partial field updates without losing unrelated fields. Currently, when updating a single field property, all other fields are lost.

## Problem Statement
- **Current Behavior**: When `partial_update: true` is used with a fields array, it replaces ALL fields
- **Expected Behavior**: Should merge individual fields by ID, preserving unmodified fields
- **Root Cause**: Line 1801 in index.ts uses `fields || existingForm.fields` instead of field-by-field merging

## Architecture Blueprint

### Core Components to Modify
1. **updateForm method** (index.ts:1734-1950)
   - Add field merging logic
   - Handle nested property updates (e.g., choices in checkbox fields)
   - Preserve field order and IDs

2. **Test Suite** (__tests__/unit/gravityFormsMCPServer.test.ts)
   - Add comprehensive tests for partial field updates
   - Test edge cases and nested property merging
   - Verify no data loss scenarios

3. **Documentation** (README.md)
   - Document partial update behavior
   - Add examples of field-level updates
   - Clarify API expectations

## Implementation Strategy

### Phase 1: Test Infrastructure
- Create test fixtures for forms with multiple fields
- Set up mock scenarios for partial updates
- Establish baseline tests for current behavior

### Phase 2: Field Merging Logic
- Implement field-by-field merging algorithm
- Handle nested properties (choices, conditionalLogic, etc.)
- Preserve field ordering and non-updated fields

### Phase 3: Edge Cases & Validation
- Handle new fields being added
- Validate field ID consistency
- Test with complex field types

### Phase 4: Integration & Documentation
- Wire everything together
- Update documentation
- Add usage examples

## Iterative Development Chunks

### Round 1: High-Level Chunks
1. Set up test infrastructure
2. Implement basic field merging
3. Handle nested properties
4. Add validation and edge cases
5. Documentation and integration

### Round 2: Refined Chunks
1. Create test fixtures and mock data
2. Write failing tests for field merging
3. Implement simple field merging (flat properties)
4. Write tests for nested property merging
5. Implement nested property merging
6. Write tests for edge cases
7. Handle edge cases
8. Update documentation
9. Integration testing

### Round 3: Right-Sized Steps
1. **Test Setup**: Create form fixtures with 4+ fields
2. **Basic Merge Test**: Test updating single field without losing others
3. **Basic Merge Implementation**: Implement field ID matching and merging
4. **Nested Property Test**: Test updating choices in checkbox field
5. **Nested Property Implementation**: Deep merge for complex properties
6. **New Field Test**: Test adding new field with partial update
7. **New Field Implementation**: Handle fields not in original form
8. **Field Order Test**: Verify field order preservation
9. **Field Order Implementation**: Maintain original field sequence
10. **Documentation**: Update README with examples
11. **Integration Test**: End-to-end test with real API mock

## TDD Prompts for Implementation

### Prompt 1: Test Infrastructure Setup ✅ COMPLETED
```text
Create test infrastructure for the update_form partial field updates feature.

1. In __tests__/unit/gravityFormsMCPServer.test.ts, add a new describe block for 'update_form partial field updates'
2. Create a mock form fixture with these fields:
   - Field ID 1: name field (type: 'name', label: 'Full Name')
   - Field ID 3: email field (type: 'email', label: 'Email')
   - Field ID 6: checkbox field with 3 choices and inventory_limit properties
   - Field ID 7: html field with content
3. Set up beforeEach to reset the mock form to original state
4. Create a helper function to verify field preservation
5. Write a simple test that fetches the mock form to verify fixture

The test should fail initially since we haven't set up the mocks yet.
```

**Status**: ✅ **COMPLETED** - Test infrastructure established with mock form fixture containing 4 fields (name, email, checkbox with choices, html). Helper function created for field preservation verification. Infrastructure test passes confirming proper setup.

### Prompt 2: Basic Field Merge Test
```text
Write failing tests for basic field merging functionality.

1. Write test: 'should preserve other fields when updating single field with partial_update'
   - Call update_form with partial_update: true
   - Update only field ID 6's label to 'Updated Checkbox'
   - Verify fields 1, 3, and 7 remain unchanged
   - Verify field 6 has updated label but preserves choices

2. Write test: 'should replace all fields when partial_update is false'
   - Call update_form with partial_update: false
   - Send only field ID 6
   - Verify only field 6 exists in response

3. Mock makeRequest to return the existing form for GET requests

These tests should fail with current implementation.
```

### Prompt 3: Basic Field Merge Implementation
```text
Implement basic field merging logic to make tests pass.

1. In index.ts updateForm method, locate the field assignment logic (around line 1801)
2. Replace the current logic:
   ```javascript
   finalFields = fields || existingForm.fields;
   ```
   With field merging logic:
   ```javascript
   if (fields && partial_update) {
     // Create a map of updated fields by ID
     const fieldUpdates = new Map();
     fields.forEach(field => {
       if (field.id) fieldUpdates.set(field.id.toString(), field);
     });
     
     // Merge with existing fields
     finalFields = existingForm.fields.map(existingField => {
       const fieldId = existingField.id?.toString();
       if (fieldId && fieldUpdates.has(fieldId)) {
         return { ...existingField, ...fieldUpdates.get(fieldId) };
       }
       return existingField;
     });
   } else {
     finalFields = fields || existingForm.fields;
   }
   ```

3. Run tests to verify basic merging works
4. Debug any issues with the merge logic

The basic field merge tests should now pass.
```

### Prompt 4: Nested Property Merge Test
```text
Write tests for merging nested properties like choices in checkbox fields.

1. Write test: 'should merge nested choices array in checkbox field'
   - Update field ID 6's second choice inventory_limit from 5 to 7
   - Keep the same choice text and other properties
   - Verify other choices remain unchanged
   - Verify field label and other properties preserved

2. Write test: 'should handle partial choice updates'
   - Update only inventory_limit without providing choice text
   - This should properly merge the choice properties

3. Write test: 'should preserve conditional logic when updating other properties'
   - Add conditional logic to mock field
   - Update field label
   - Verify conditional logic remains intact

These tests will fail because shallow merge doesn't handle nested properties.
```

### Prompt 5: Nested Property Merge Implementation
```text
Implement deep merging for nested field properties.

1. Create a helper function for deep merging:
   ```javascript
   private mergeFieldProperties(existing: any, updates: any): any {
     // Handle choices array specially
     if (updates.choices && existing.choices) {
       const mergedChoices = existing.choices.map((existingChoice: any, index: number) => {
         if (updates.choices[index]) {
           return { ...existingChoice, ...updates.choices[index] };
         }
         return existingChoice;
       });
       return { ...existing, ...updates, choices: mergedChoices };
     }
     
     // Default shallow merge for other properties
     return { ...existing, ...updates };
   }
   ```

2. Update the field merging logic to use deep merge:
   ```javascript
   finalFields = existingForm.fields.map(existingField => {
     const fieldId = existingField.id?.toString();
     if (fieldId && fieldUpdates.has(fieldId)) {
       const updates = fieldUpdates.get(fieldId);
       return this.mergeFieldProperties(existingField, updates);
     }
     return existingField;
   });
   ```

3. Run tests to verify nested property merging
4. Handle any edge cases discovered during testing

Nested property tests should now pass.
```

### Prompt 6: New Field Addition Test
```text
Write tests for adding new fields during partial updates.

1. Write test: 'should add new field when it does not exist in original form'
   - Use partial_update: true
   - Include existing field 6 and new field 10
   - Verify all original fields preserved
   - Verify new field 10 is added

2. Write test: 'should maintain field order when adding new fields'
   - Add field with ID 5 (between existing 3 and 6)
   - Verify fields are in ID order: 1, 3, 5, 6, 7

3. Write test: 'should handle array of new fields'
   - Add multiple new fields at once
   - Verify all are added correctly

These tests will fail as current logic only updates existing fields.
```

### Prompt 7: New Field Addition Implementation
```text
Implement logic to handle new fields during partial updates.

1. Update the field merging logic to handle new fields:
   ```javascript
   if (fields && partial_update) {
     const fieldUpdates = new Map();
     fields.forEach(field => {
       if (field.id) fieldUpdates.set(field.id.toString(), field);
     });
     
     // First, update existing fields
     finalFields = existingForm.fields.map(existingField => {
       const fieldId = existingField.id?.toString();
       if (fieldId && fieldUpdates.has(fieldId)) {
         const updates = fieldUpdates.get(fieldId);
         fieldUpdates.delete(fieldId); // Mark as processed
         return this.mergeFieldProperties(existingField, updates);
       }
       return existingField;
     });
     
     // Then, add any new fields
     fieldUpdates.forEach(newField => {
       finalFields.push(newField);
     });
     
     // Sort by field ID to maintain consistent order
     finalFields.sort((a, b) => {
       const idA = parseInt(a.id) || 0;
       const idB = parseInt(b.id) || 0;
       return idA - idB;
     });
   }
   ```

2. Test the implementation
3. Verify field ordering is maintained

New field addition tests should pass.
```

### Prompt 8: Edge Cases Test
```text
Write tests for edge cases and error conditions.

1. Write test: 'should handle empty fields array with partial_update'
   - Send empty fields array with partial_update: true
   - Should preserve all existing fields

2. Write test: 'should handle fields without IDs'
   - Send field without ID property
   - Should skip or error appropriately

3. Write test: 'should handle malformed field data'
   - Send field with invalid structure
   - Should validate and provide meaningful error

4. Write test: 'should preserve field-specific settings'
   - Test with fields containing:
     - Validation rules
     - Default values
     - CSS classes
     - Admin labels

These tests ensure robustness of the implementation.
```

### Prompt 9: Edge Cases Implementation
```text
Implement edge case handling and validation.

1. Add validation for field IDs:
   ```javascript
   if (fields && partial_update) {
     // Validate fields have IDs
     const invalidFields = fields.filter(f => !f.id);
     if (invalidFields.length > 0) {
       throw new McpError(
         ErrorCode.InvalidParams,
         'All fields must have an ID when using partial_update'
       );
     }
     
     // Continue with merging logic...
   }
   ```

2. Handle empty fields array:
   ```javascript
   if (fields && fields.length === 0 && partial_update) {
     finalFields = existingForm.fields;
   }
   ```

3. Add debug logging for edge cases
4. Ensure all validation provides clear error messages

Edge case tests should pass.
```

### Prompt 10: Documentation Update
```text
Update documentation to explain the new partial update behavior.

1. In README.md, add a section about partial field updates:
   - Explain when to use partial_update: true
   - Provide example of updating single field property
   - Show how to update nested properties like choices
   - Document the field merging behavior

2. Add code examples:
   ```javascript
   // Example: Update inventory limit for one choice
   mcp.update_form({
     form_id: "217",
     partial_update: true,
     fields: [{
       id: 6,
       choices: [
         { text: "Yes, as event lead.", inventory_limit: "1" },
         { text: "Yes, as primary instructor.", inventory_limit: 7 },
         { text: "Yes, as assistant.", inventory_limit: "4" }
       ]
     }]
   });
   ```

3. Document the difference between partial_update true/false
4. Add troubleshooting section for common issues

Documentation should be clear and comprehensive.
```

### Prompt 11: Integration Testing
```text
Create end-to-end integration tests to verify the complete workflow.

1. Write integration test: 'complete partial update workflow'
   - Fetch existing form
   - Update single field property
   - Verify response
   - Fetch form again to confirm persistence

2. Write test: 'multiple sequential partial updates'
   - Update field 1
   - Update field 3
   - Update field 6
   - Verify cumulative changes

3. Write test: 'partial update with API error handling'
   - Simulate API errors
   - Verify appropriate error messages
   - Ensure no data corruption

4. Run all tests together to ensure no regressions
5. Verify test coverage for the updateForm method

All tests should pass, confirming the implementation is complete.
```

## Success Criteria

1. ✅ All existing tests continue to pass
2. ✅ New partial field update tests pass
3. ✅ Can update single field property without losing others
4. ✅ Nested properties (choices) merge correctly
5. ✅ New fields can be added during partial updates
6. ✅ Field order is preserved
7. ✅ Edge cases handled gracefully
8. ✅ Documentation is clear and complete
9. ✅ No performance degradation
10. ✅ Backwards compatibility maintained

## Risk Mitigation

- **Backup Strategy**: Keep original logic available via flag
- **Testing**: Comprehensive test coverage before deployment
- **Rollback Plan**: Version control allows quick reversion
- **Monitoring**: Add debug logging for production issues

## Notes

- The Gravity Forms API itself replaces the entire fields array when updating
- Our wrapper adds value by implementing field-level merging
- This matches user expectations for "partial updates"
- Consider adding a separate `update_form_field` tool in future for clarity