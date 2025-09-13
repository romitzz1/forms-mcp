# TODO: Gravity Forms Field Update Fix

## Current Status: Planning Complete ✅

### Implementation Roadmap

#### Phase 1: Test Infrastructure ✅ COMPLETED
- [x] **Prompt 1**: Set up test fixtures with 4+ fields ✅ COMPLETED
- [x] **Prompt 2**: Write failing tests for basic field merging ✅ COMPLETED
- [x] Verify test failures demonstrate current issue ✅ COMPLETED

#### Phase 2: Basic Field Merging 📋
- [ ] **Prompt 3**: Implement field ID matching and merging
- [ ] Verify basic field preservation tests pass
- [ ] Debug any merge logic issues

#### Phase 3: Nested Properties 📋
- [ ] **Prompt 4**: Write tests for choices array merging
- [ ] **Prompt 5**: Implement deep merge for nested properties
- [ ] Test conditional logic preservation

#### Phase 4: New Field Handling 📋
- [ ] **Prompt 6**: Write tests for adding new fields
- [ ] **Prompt 7**: Implement new field addition logic
- [ ] Verify field ordering maintained

#### Phase 5: Edge Cases 📋
- [ ] **Prompt 8**: Write edge case tests
- [ ] **Prompt 9**: Implement validation and error handling
- [ ] Test empty arrays, missing IDs, malformed data

#### Phase 6: Documentation & Integration 📋
- [ ] **Prompt 10**: Update README with examples
- [ ] **Prompt 11**: Create end-to-end integration tests
- [ ] Final testing and validation

## Test-Driven Development Checklist

### Before Each Prompt
- [ ] Review previous prompt completion
- [ ] Understand current test state
- [ ] Identify what should fail/pass

### After Each Prompt
- [ ] Run tests to verify expected behavior
- [ ] Debug any unexpected failures
- [ ] Commit working code
- [ ] Update this TODO with progress

## Key Files to Modify

### Primary Implementation
- [ ] `index.ts` (lines 1800-1805) - Field merging logic
- [ ] `index.ts` - Add mergeFieldProperties helper method

### Testing
- [ ] `__tests__/unit/gravityFormsMCPServer.test.ts` - New test suite
- [ ] Test fixtures for mock forms
- [ ] Edge case testing

### Documentation
- [ ] `README.md` - Partial update examples
- [ ] `README.md` - API behavior clarification

## Success Metrics

### Functional Requirements ✅ = Pass, ❌ = Fail, ⏳ = In Progress

- ⏳ Update single field without losing others
- ⏳ Merge nested properties (choices)
- ⏳ Add new fields during partial update
- ⏳ Preserve field order
- ⏳ Handle edge cases gracefully
- ⏳ Maintain backwards compatibility

### Quality Requirements

- ⏳ 100% test coverage for modified code
- ⏳ All existing tests continue to pass
- ⏳ Clear documentation with examples
- ⏳ Performance maintained or improved

## Risk Management

### High Risk Items
- [ ] Breaking existing API compatibility
- [ ] Data loss during field updates
- [ ] Performance impact on large forms

### Mitigation Strategies
- [ ] Comprehensive test coverage before changes
- [ ] Feature flag for new behavior
- [ ] Backup/rollback plan documented

## Current Implementation Gaps

### Identified Issues
1. ✅ Line 1801: `fields || existingForm.fields` replaces all fields
2. ✅ No field-by-field merging logic
3. ✅ Nested property merging not implemented
4. ✅ New field addition not handled in partial mode

### Required Components
- [ ] Field ID mapping and lookup
- [ ] Deep merge algorithm for nested properties
- [ ] Field order preservation logic
- [ ] Validation for partial update constraints

## Next Steps

1. **Start with Prompt 1**: Set up test infrastructure
2. **Follow TDD cycle**: Red → Green → Refactor for each prompt
3. **Commit frequently**: After each working implementation
4. **Update TODO**: Mark completed items and note any issues

---

## Notes

- Keep original behavior when `partial_update: false`
- Gravity Forms API always replaces entire fields array
- Our wrapper adds value with field-level merging
- Consider adding separate `update_form_field` tool later