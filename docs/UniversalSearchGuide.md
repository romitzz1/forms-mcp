# Universal Search System - User Guide

## Overview

The Universal Search System transforms name searching from a manual, error-prone process to a fast, intelligent, single-command operation that works across any Gravity Form structure without configuration.

### Key Features

- **Automatic Field Detection**: Intelligently identifies name, email, phone, and team fields
- **Single API Call**: Most searches complete with just one request (vs previous 3-6 calls)
- **Token Safe**: All responses under 25k tokens (prevents context overflow crashes)
- **Universal Compatibility**: Works on any form without configuration
- **Performance Optimized**: <2 second response times with comprehensive caching

## Quick Start Guide

### Basic Name Search

The simplest way to search for names across any form:

```javascript
// Search for "John Smith" in form 193
const result = await search_entries_by_name({
  form_id: "193",
  search_text: "John Smith"
});
```

**Expected Output:**
```
Found 2 matches for "John Smith" in form 193 (League Sign up 25-26):

Entry #10795 (High Confidence: 0.95)
- Name: John Smith (field 52)
- Email: john.smith@email.com (field 54)  
- Payment: $200.00 Paid
- Date: 2025-09-03 15:43:56

Entry #10792 (Medium Confidence: 0.75)
- Team Member: "John Smith" mentioned in field 17
- Primary Name: Different Person (field 52)
- Payment: $0.00 Unpaid

Search completed in 1.2s using auto-detected name fields.
```

### Advanced Multi-Field Search

For more complex searches across multiple field types:

```javascript
// Search for "John" in name fields AND "gmail.com" in email fields
const result = await search_entries_universal({
  form_id: "193",
  search_queries: [
    { text: "John", field_types: ["name"] },
    { text: "gmail.com", field_types: ["email"] }
  ],
  logic: "AND"
});
```

### Field Structure Inspection

To understand how the system sees your form:

```javascript
// Inspect detected field types and mappings
const mappings = await get_field_mappings({
  form_id: "193",
  include_details: true
});
```

**Expected Output:**
```
Field Mappings for Form 193 (League Sign up 25-26):

NAME FIELDS (Recommended for name searches):
- Field 52: "Name" → name (confidence: 0.95)
- Field 55: "Full Name" → name (confidence: 0.90)

EMAIL FIELDS:
- Field 50: "Username" → text (confidence: 0.60) 
- Field 54: "Email Address" → email (confidence: 1.00)

TEAM/GROUP FIELDS:
- Field 17: "Team Members" → team (confidence: 0.85)
- Field 32: "Notes/Comments" → text (confidence: 0.30)

FORM COMPLEXITY:
- Total fields: 61
- Text fields: 34
- Complex fields: 12 (name, email, address)
- Conditional logic: Yes (15 conditions detected)

CACHE STATUS: Fresh (generated 2 minutes ago)
```

## Tool Reference

### search_entries_by_name

**Primary universal name search tool**

**Parameters:**
- `form_id` (required): Form ID to search
- `search_text` (required): Name to search for
- `strategy` (optional): 'exact' | 'contains' | 'fuzzy' | 'auto' (default: 'auto')
- `max_results` (optional): Maximum results to return (default: 50)
- `output_mode` (optional): 'detailed' | 'summary' | 'minimal' | 'auto' (default: 'auto')

**Use Cases:**
- Quick name lookup: `search_entries_by_name({form_id: "123", search_text: "John Smith"})`
- Fuzzy matching: `search_entries_by_name({form_id: "123", search_text: "Jon Smyth", strategy: "fuzzy"})`
- Team mentions: Automatically searches both name fields and team/group fields

### search_entries_universal

**Advanced multi-field search tool**

**Parameters:**
- `form_id` (required): Form ID to search
- `search_queries` (required): Array of search queries with targeting
- `logic` (optional): 'AND' | 'OR' (default: 'OR')
- `strategy` (optional): Search strategy per query
- `filters` (optional): Additional filtering options
- `output_options` (optional): Detailed formatting controls

**Advanced Examples:**

```javascript
// Multiple search terms with OR logic
await search_entries_universal({
  form_id: "193",
  search_queries: [
    { text: "John Smith" },
    { text: "Jane Doe" }
  ],
  logic: "OR"
});

// Custom field targeting
await search_entries_universal({
  form_id: "193", 
  search_queries: [
    { text: "Team Alpha", field_types: ["team"] },
    { text: "manager@company.com", field_ids: ["54", "60"] }
  ]
});
```

### get_field_mappings

**Field structure analysis and debugging tool**

**Parameters:**
- `form_id` (required): Form ID to analyze
- `include_details` (optional): Include detailed analysis (default: false)
- `refresh_cache` (optional): Force cache refresh (default: false)

**Use Cases:**
- Debug search issues: "Why didn't it find the name?"
- Form development: "Which fields will be searchable?"
- Performance optimization: "How complex is this form?"

### Enhanced get_entries

**Backward-compatible tool with universal search capabilities**

**New Parameters:**
- `search_mode` (optional): 'standard' | 'universal' (default: 'standard')
- `response_mode` (optional): 'full' | 'summary' | 'auto' (default: 'auto')
- `field_detection` (optional): Enable automatic field detection (default: false)

**Migration Example:**

```javascript
// Existing usage (unchanged)
await get_entries({
  form_id: "193",
  search: { key: "52", value: "John" }
});

// New universal search mode
await get_entries({
  form_id: "193", 
  search: { key: "52", value: "John" },
  search_mode: "universal",  // NEW: Enables universal search
  field_detection: true      // NEW: Auto-detects field types
});
```

## Common Workflows

### Search → Export Workflow

1. **Search for entries:**
   ```javascript
   const searchResult = await search_entries_by_name({
     form_id: "193",
     search_text: "Team Captain"
   });
   ```

2. **Extract entry IDs:**
   ```javascript
   const entryIds = searchResult.matches.map(match => match.entryId);
   ```

3. **Export filtered results:**
   ```javascript
   await export_entries_formatted({
     form_id: "193",
     format: "csv",
     search: {
       field_filters: [{ key: "1", value: entryIds.join("|"), operator: "in" }]
     }
   });
   ```

### Template Creation from Search Results

1. **Find a good source form:**
   ```javascript
   const searchResult = await search_entries_by_name({
     form_id: "193", 
     search_text: "sample"
   });
   ```

2. **Analyze form structure:**
   ```javascript
   const mappings = await get_field_mappings({
     form_id: "193"
   });
   ```

3. **Create template if suitable:**
   ```javascript
   if (searchResult.matches.length > 0 && mappings.nameFields.length > 0) {
     await save_form_as_template({
       form_id: "193",
       template_name: "League Registration Template"
     });
   }
   ```

## Performance Optimization

### Form Design Recommendations

**Optimal Field Naming for Auto-Detection:**

✅ **Good Names:**
- "Name", "Full Name", "First Name", "Last Name"
- "Email Address", "Email", "Contact Email"  
- "Team Members", "Team Name", "Group"
- "Phone Number", "Phone", "Mobile"

❌ **Avoid:**
- Generic labels like "Field 1", "Text Input"
- Ambiguous terms like "Info", "Data", "Value"
- Single letters like "N", "E", "P"

### Cache Configuration

**Environment Variables:**
```bash
# Field mapping cache settings
FIELD_MAPPING_CACHE_MAX_AGE_MS=3600000    # 1 hour (default)
FIELD_MAPPING_CACHE_MAX_SIZE=100          # 100 forms (default) 
FIELD_MAPPING_CACHE_ENABLED=true          # Enable caching (default)

# Search result cache settings  
SEARCH_CACHE_ENABLED=true                 # Enable search caching
SEARCH_CACHE_MAX_AGE_MS=900000           # 15 minutes (default)

# Performance monitoring
PERFORMANCE_MONITORING_ENABLED=true      # Track metrics (default)
```

### Performance Targets

| Metric | Target | Baseline (Before) |
|--------|--------|------------------|
| API Calls | <2 per search | 3-6 calls |
| Response Time | <2 seconds | 10+ seconds |
| Token Count | <25k tokens | 66k+ (crashes) |
| Field Detection | >95% accuracy | Manual only |
| Cache Hit Rate | >70% | No caching |

## Troubleshooting

### Common Issues

**"Name not found" but entry exists:**
1. Check field mappings: `get_field_mappings({form_id: "123"})`
2. Verify field naming follows conventions
3. Try different search strategies: `fuzzy`, `contains`
4. Check if name is in team/group fields

**"Search too slow":**
1. Verify cache is enabled and populated
2. Check form complexity with `get_field_mappings`
3. Use `summary` output mode for large result sets
4. Consider field-specific targeting with `search_entries_universal`

**"Token overflow errors":**
1. Use `response_mode: "summary"` or `"auto"`
2. Reduce `max_results` parameter
3. Use targeted searches instead of broad searches

### Debug Commands

```javascript
// Check system health
const health = await get_cache_status();

// Force cache refresh
await get_field_mappings({
  form_id: "123",
  refresh_cache: true
});

// Test field detection
const mappings = await get_field_mappings({
  form_id: "123", 
  include_details: true
});
```

## Migration Guide

### From Manual Search to Universal Search

**Before (Manual):**
```javascript
// Required knowledge of specific field IDs
await get_entries({
  form_id: "193",
  search: { key: "52", value: "John Smith" }  // Must know field 52 is name
});
```

**After (Universal):**
```javascript
// Automatic field detection
await search_entries_by_name({
  form_id: "193",
  search_text: "John Smith"  // Works on any form structure
});
```

### Gradual Adoption Strategy

1. **Phase 1**: Use `get_field_mappings` to understand your forms
2. **Phase 2**: Try `search_entries_by_name` for simple name searches  
3. **Phase 3**: Adopt `search_entries_universal` for complex workflows
4. **Phase 4**: Enable `search_mode: "universal"` in existing `get_entries` calls

## API Reference

### Error Codes

| Code | Message | Resolution |
|------|---------|------------|
| `FORM_NOT_FOUND` | Form {id} not found | Verify form ID exists |
| `SEARCH_TEXT_REQUIRED` | Search text is required | Provide non-empty search_text |
| `FIELD_DETECTION_FAILED` | Could not detect field types | Check form structure, try refresh_cache |
| `API_RATE_LIMIT` | Rate limit exceeded | Implement retry with backoff |
| `CACHE_ERROR` | Cache system unavailable | System will fallback to API-only mode |

### Response Formats

**SearchResult Structure:**
```typescript
interface SearchResult {
  matches: SearchMatch[];           // Array of matched entries
  totalFound: number;              // Total matches found
  searchMetadata: SearchMetadata;  // Execution details
}

interface SearchMatch {
  entryId: string;                    // Gravity Forms entry ID
  matchedFields: {[fieldId: string]: string};  // Fields that matched
  confidence: number;                 // Match confidence 0.0-1.0
}
```

**Field Mapping Structure:**
```typescript
interface FieldMapping {
  [fieldId: string]: FieldTypeInfo;
}

interface FieldTypeInfo {
  fieldId: string;           // Gravity Forms field ID
  fieldType: DetectedFieldType;  // Detected type
  confidence: number;        // Detection confidence 0.0-1.0
  label: string;            // Field label from form
}
```

This comprehensive guide enables users to fully leverage the Universal Search System's capabilities while understanding its performance characteristics and optimization opportunities.