# Universal Search API Reference

## Overview

The Universal Search System provides 4 main tools for intelligent form entry searching. All tools follow MCP (Model Context Protocol) standards and return structured responses.

## Core Search Tools

### search_entries_by_name

**Primary universal name search tool**

Automatically detects name fields across any form and performs intelligent searching with confidence scoring.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `form_id` | string | ✅ | - | Gravity Forms form ID |
| `search_text` | string | ✅ | - | Name to search for |
| `strategy` | string | ❌ | `"auto"` | Search strategy: `"exact"`, `"contains"`, `"fuzzy"`, `"auto"` |
| `max_results` | number | ❌ | `50` | Maximum results to return (1-500) |
| `output_mode` | string | ❌ | `"auto"` | Output format: `"detailed"`, `"summary"`, `"minimal"`, `"auto"` |

#### Example Usage

```javascript
// Basic name search
const result = await search_entries_by_name({
  form_id: "193",
  search_text: "John Smith"
});

// Fuzzy search with custom limits
const result = await search_entries_by_name({
  form_id: "193", 
  search_text: "Jon Smyth",
  strategy: "fuzzy",
  max_results: 25,
  output_mode: "summary"
});
```

#### Response Format

```typescript
interface SearchByNameResponse {
  success: boolean;
  result: {
    content: string;           // Formatted search results
    tokenCount: number;        // Response token count
    resultCount: number;       // Number of matches found
    metadata: {
      formId: string;
      searchText: string;
      strategy: string;
      fieldsSearched: number;
      executionTimeMs: number;
      cacheStatus: {
        hit: boolean;
        source: "cache" | "analysis";
        timestamp: string;
      };
    };
  };
}
```

#### Search Strategies

- **`exact`**: Exact text matching only
- **`contains`**: Substring matching (case-insensitive)  
- **`fuzzy`**: Levenshtein distance matching (handles typos)
- **`auto`**: Automatically selects best strategy based on input

---

### search_entries_universal

**Advanced multi-field search with custom targeting**

Provides maximum flexibility for complex search scenarios with multiple queries and logical operators.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `form_id` | string | ✅ | - | Gravity Forms form ID |
| `search_queries` | SearchQuery[] | ✅ | - | Array of search queries with targeting |
| `logic` | string | ❌ | `"OR"` | Combine queries with `"AND"` or `"OR"` |
| `strategy` | string | ❌ | `"auto"` | Default strategy for queries |
| `filters` | object | ❌ | `{}` | Additional filtering options |
| `output_options` | object | ❌ | `{}` | Output formatting controls |

#### SearchQuery Structure

```typescript
interface SearchQuery {
  text: string;                    // Search text
  field_types?: string[];          // Target field types: ["name", "email", "phone", "team"]
  field_ids?: string[];            // Specific field IDs to search
  strategy?: string;               // Override default strategy for this query
}
```

#### Example Usage

```javascript
// Multiple search terms with OR logic
const result = await search_entries_universal({
  form_id: "193",
  search_queries: [
    { text: "John Smith" },
    { text: "Jane Doe" }
  ],
  logic: "OR"
});

// Complex multi-field search with AND logic
const result = await search_entries_universal({
  form_id: "193",
  search_queries: [
    { text: "Manager", field_types: ["name"] },
    { text: "gmail.com", field_types: ["email"] },
    { text: "Team Alpha", field_types: ["team"] }
  ],
  logic: "AND",
  output_options: {
    include_field_details: true,
    highlight_matches: true
  }
});

// Custom field targeting
const result = await search_entries_universal({
  form_id: "193",
  search_queries: [
    { text: "VIP Customer", field_ids: ["52", "55", "17"] }
  ]
});
```

#### Response Format

```typescript
interface UniversalSearchResponse {
  success: boolean;
  result: {
    content: string;
    tokenCount: number;
    resultCount: number;
    queryResults: {
      [queryIndex: number]: {
        matches: number;
        fields: string[];
        strategy: string;
      };
    };
    metadata: {
      formId: string;
      totalQueries: number;
      logic: string;
      executionTimeMs: number;
    };
  };
}
```

---

### get_field_mappings

**Form structure analysis and field type detection**

Analyzes form structure and returns detected field types with confidence scores. Essential for debugging and optimization.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `form_id` | string | ✅ | - | Gravity Forms form ID |
| `include_details` | boolean | ❌ | `false` | Include detailed analysis |
| `refresh_cache` | boolean | ❌ | `false` | Force cache refresh |

#### Example Usage

```javascript
// Basic field mapping
const mappings = await get_field_mappings({
  form_id: "193"
});

// Detailed analysis with cache refresh
const mappings = await get_field_mappings({
  form_id: "193",
  include_details: true,
  refresh_cache: true
});
```

#### Response Format

```typescript
interface FieldMappingsResponse {
  success: boolean;
  result: {
    formId: string;
    formTitle: string;
    fieldMappings: {
      [fieldId: string]: {
        fieldId: string;
        fieldType: "name" | "email" | "phone" | "team" | "text" | "unknown";
        confidence: number;        // 0.0 to 1.0
        label: string;
        detectionReason?: string;  // If include_details = true
      };
    };
    summary: {
      totalFields: number;
      nameFields: number;
      emailFields: number;
      phoneFields: number;
      teamFields: number;
      textFields: number;
      complexFields: number;
    };
    recommendations: {
      primaryNameFields: string[];     // Best fields for name searches
      primaryEmailFields: string[];
      searchableFields: string[];      // All searchable fields
    };
    formComplexity: {
      complexity: "simple" | "moderate" | "complex";
      hasConditionalLogic: boolean;
      hasMultiplePages: boolean;
      estimatedSearchTime: number;    // milliseconds
    };
    cacheStatus: {
      cached: boolean;
      age: number;                    // seconds since cached
      source: "cache" | "fresh_analysis";
    };
  };
}
```

---

### Enhanced get_entries

**Backward-compatible search with optional universal capabilities**

Extends the standard `get_entries` tool with universal search features while maintaining 100% backward compatibility.

#### New Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `search_mode` | string | ❌ | `"standard"` | `"standard"` or `"universal"` |
| `response_mode` | string | ❌ | `"auto"` | `"full"`, `"summary"`, or `"auto"` |
| `field_detection` | boolean | ❌ | `false` | Enable automatic field detection |

#### Migration Examples

```javascript
// Existing usage (unchanged)
const entries = await get_entries({
  form_id: "193",
  search: { key: "52", value: "John Smith" }
});

// Enhanced with universal search
const entries = await get_entries({
  form_id: "193",
  search: { key: "52", value: "John Smith" },
  search_mode: "universal",        // Enable universal search
  response_mode: "summary",        // Manage response size
  field_detection: true            // Auto-detect field types
});

// Universal search with traditional parameters
const entries = await get_entries({
  form_id: "193",
  search_text: "John Smith",       // Universal search text
  search_mode: "universal",
  paging: { page_size: 25, current_page: 1 }
});
```

## Utility Tools

### get_cache_status

**System health and cache monitoring**

Returns comprehensive information about cache performance and system health.

#### Parameters

None required.

#### Example Usage

```javascript
const status = await get_cache_status();
```

#### Response Format

```typescript
interface CacheStatusResponse {
  success: boolean;
  result: {
    cacheHealth: {
      fieldMappingCache: {
        enabled: boolean;
        hitRate: number;            // 0.0 to 1.0
        entryCount: number;
        memoryUsage: string;
        oldestEntry: string;        // ISO date
        newestEntry: string;        // ISO date
      };
      searchResultsCache: {
        enabled: boolean;
        hitRate: number;
        entryCount: number;
        memoryUsage: string;
        averageQueryTime: number;   // milliseconds
      };
    };
    performance: {
      totalSearches: number;
      averageSearchTime: number;   // milliseconds
      errorRate: number;           // 0.0 to 1.0
      cacheEffectiveness: number;  // 0.0 to 1.0
    };
    systemInfo: {
      uptime: number;              // seconds
      memoryUsage: {
        used: string;
        total: string;
        percentage: number;
      };
      version: string;
    };
  };
}
```

## Field Type Detection

### Detected Field Types

The system automatically detects these field types:

| Field Type | Description | Detection Keywords |
|------------|-------------|-------------------|
| `name` | Name fields (first, last, full name) | "name", "first", "last", "full name", "participant", "attendee", "member" |
| `email` | Email address fields | "email", "e-mail", "mail", "contact" |
| `phone` | Phone number fields | "phone", "tel", "mobile", "cell", "contact" |
| `team` | Team/group reference fields | "team", "group", "with", "partner", "squad", "members" |
| `text` | Generic text fields | Any text field not matching above |
| `unknown` | Unclassified fields | Fields that couldn't be classified |

### Confidence Scoring

| Confidence Range | Meaning | Example |
|-----------------|---------|---------|
| 0.9 - 1.0 | High confidence | "Email Address" → email (1.0) |
| 0.7 - 0.89 | Medium confidence | "Contact Info" → email (0.75) |
| 0.5 - 0.69 | Low confidence | "Info" → text (0.6) |
| 0.0 - 0.49 | Very low/unknown | "Field 1" → unknown (0.3) |

## Error Handling

### Error Codes

| Code | HTTP Status | Description | Resolution |
|------|-------------|-------------|------------|
| `FORM_NOT_FOUND` | 404 | Form ID does not exist | Verify form ID is correct |
| `SEARCH_TEXT_REQUIRED` | 400 | Missing or empty search text | Provide valid search_text parameter |
| `INVALID_FORM_ID` | 400 | Malformed form ID | Use numeric string form ID |
| `FIELD_DETECTION_FAILED` | 500 | Could not analyze form structure | Try refresh_cache=true or check form |
| `CACHE_ERROR` | 500 | Cache system unavailable | System falls back to direct API calls |
| `API_RATE_LIMIT` | 429 | Gravity Forms rate limit exceeded | Implement retry with exponential backoff |
| `API_AUTHENTICATION` | 401 | Invalid API credentials | Check CONSUMER_KEY and CONSUMER_SECRET |
| `API_NETWORK_ERROR` | 503 | Network connectivity issues | Check network connection and API endpoint |

### Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    requestId?: string;
  };
}
```

### Error Handling Examples

```javascript
try {
  const result = await search_entries_by_name({
    form_id: "193",
    search_text: "John Smith"
  });
} catch (error) {
  switch (error.code) {
    case 'FORM_NOT_FOUND':
      console.error('Form does not exist:', error.message);
      break;
    case 'API_RATE_LIMIT':
      console.error('Rate limited, retrying in 60 seconds...');
      setTimeout(() => retry(), 60000);
      break;
    case 'FIELD_DETECTION_FAILED':
      console.error('Field detection failed, trying cache refresh...');
      await get_field_mappings({ form_id: "193", refresh_cache: true });
      break;
    default:
      console.error('Unexpected error:', error);
  }
}
```

## Rate Limiting

### Gravity Forms API Limits

The system respects Gravity Forms API rate limits:

- **Default**: 60 requests per minute
- **Burst**: Up to 10 requests in quick succession
- **Backoff**: Automatic retry with exponential backoff

### Best Practices

1. **Cache Utilization**: Enable caching to reduce API calls
2. **Batch Operations**: Use `search_entries_universal` for multiple queries
3. **Result Limiting**: Use appropriate `max_results` values
4. **Error Handling**: Implement proper retry logic for rate limit errors

## Performance Characteristics

### Response Times

| Operation | Target | Cache Hit | Cache Miss |
|-----------|---------|-----------|------------|
| Field Detection | <500ms | <50ms | <2000ms |
| Name Search | <1000ms | <200ms | <2000ms |
| Universal Search | <1500ms | <300ms | <3000ms |
| Field Mappings | <200ms | <50ms | <1000ms |

### Memory Usage

| Component | Typical Usage | Max Recommended |
|-----------|---------------|-----------------|
| Field Mapping Cache | 1-5MB | 50MB |
| Search Results Cache | 2-10MB | 100MB |
| Total System | 5-20MB | 200MB |

### Token Management

All responses are automatically managed to stay under 25k tokens:

- **Auto-summarization** when response would exceed 20k tokens
- **Intelligent truncation** preserving most relevant information
- **Token estimation** using 4:1 character-to-token ratio

## Integration Examples

### Search & Export Workflow

```javascript
// 1. Search for entries
const searchResult = await search_entries_by_name({
  form_id: "193",
  search_text: "Team Captain"
});

// 2. Extract entry IDs
const entryIds = searchResult.matches?.map(match => match.entryId) || [];

// 3. Export filtered results
if (entryIds.length > 0) {
  await export_entries_formatted({
    form_id: "193",
    format: "csv",
    search: {
      field_filters: [{ 
        key: "id", 
        value: entryIds.join(","), 
        operator: "in" 
      }]
    }
  });
}
```

### Bulk Operations Integration

```javascript
// 1. Find entries to update
const searchResult = await search_entries_universal({
  form_id: "193",
  search_queries: [
    { text: "Unpaid", field_types: ["text"] }
  ]
});

// 2. Extract entry IDs
const entryIds = searchResult.matches?.map(match => match.entryId) || [];

// 3. Bulk update payment status
if (entryIds.length > 0) {
  await process_entries_bulk({
    entry_ids: entryIds,
    operation_type: "update_fields",
    data: { payment_status: "Pending" },
    confirm: true
  });
}
```

## Version Compatibility

| Universal Search Version | MCP SDK Version | Node.js Version |
|-------------------------|-----------------|-----------------|
| 1.0.0+ | 0.4.0+ | 18.0.0+ |

This API reference provides complete technical documentation for all Universal Search System tools and capabilities.