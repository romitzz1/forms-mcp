# Universal Search Troubleshooting Guide

## Quick Diagnostic Steps

When experiencing issues, run these diagnostic commands first:

```javascript
// 1. Check system health
const health = await get_cache_status();
console.log('System Health:', health);

// 2. Test basic connectivity
const forms = await get_forms();
console.log('API Connectivity:', forms ? '✅ Working' : '❌ Failed');

// 3. Analyze problematic form
const mappings = await get_field_mappings({ 
  form_id: "YOUR_FORM_ID", 
  include_details: true 
});
console.log('Field Analysis:', mappings);

// 4. Test search functionality
const search = await search_entries_by_name({
  form_id: "YOUR_FORM_ID",
  search_text: "test"
});
console.log('Search Test:', search);
```

## Common Issues & Solutions

### 1. "Name not found" but entry exists

**Symptoms:**
- Search returns no results
- You know the name exists in the form
- Manual searches in Gravity Forms work

**Diagnostic Steps:**
```javascript
// Check field detection
const mappings = await get_field_mappings({ 
  form_id: "123", 
  include_details: true 
});
console.log('Detected name fields:', mappings.summary.nameFields);
console.log('Field mappings:', mappings.fieldMappings);
```

**Common Causes & Solutions:**

#### Cause: Poor field naming
```javascript
// Problem: Generic field labels
{
  "52": { "label": "Text Input", "fieldType": "text", "confidence": 0.3 }
}

// Solution: Update form field labels to be more descriptive
// - Change "Text Input" to "Full Name"
// - Change "Field 1" to "First Name"
// - Change "Info" to "Email Address"
```

#### Cause: Name in team/group fields only
```javascript
// Check if name appears in team fields
const result = await search_entries_universal({
  form_id: "123",
  search_queries: [
    { text: "John Smith", field_types: ["team", "text"] }
  ]
});
```

#### Cause: Name format variations
```javascript
// Try different search strategies
await search_entries_by_name({
  form_id: "123",
  search_text: "John Smith",
  strategy: "fuzzy"  // Handles "Jon Smith", "J. Smith", etc.
});

await search_entries_by_name({
  form_id: "123", 
  search_text: "Smith",  // Try last name only
  strategy: "contains"
});
```

### 2. Slow search performance

**Symptoms:**
- Searches take >5 seconds
- Timeouts or performance warnings
- High memory usage

**Diagnostic Steps:**
```javascript
// Check cache effectiveness
const health = await get_cache_status();
console.log('Cache hit rate:', health.cacheHealth.fieldMappingCache.hitRate);
console.log('Average search time:', health.performance.averageSearchTime);
```

**Performance Solutions:**

#### Enable/optimize caching
```bash
# Environment variables
FIELD_MAPPING_CACHE_ENABLED=true
FIELD_MAPPING_CACHE_MAX_SIZE=100
SEARCH_CACHE_ENABLED=true
SEARCH_CACHE_MAX_AGE_MS=900000  # 15 minutes
```

#### Reduce response size
```javascript
// Use summary mode for large result sets
await search_entries_by_name({
  form_id: "123",
  search_text: "John",
  output_mode: "summary",  // vs "detailed"
  max_results: 25         // vs 50 default
});
```

#### Optimize form structure
```javascript
// Identify complex forms
const mappings = await get_field_mappings({ 
  form_id: "123", 
  include_details: true 
});

if (mappings.formComplexity.complexity === "complex") {
  console.log("Consider form simplification:");
  console.log("- Reduce conditional logic");
  console.log("- Consolidate similar fields");  
  console.log("- Use clear field naming");
}
```

### 3. Token overflow / Context crashes

**Symptoms:**
- "Context overflow" errors
- Responses cut off unexpectedly
- Claude crashes during search results

**Solutions:**

#### Enable automatic summarization
```javascript
// System automatically summarizes when >20k tokens
await search_entries_by_name({
  form_id: "123",
  search_text: "John",
  output_mode: "auto"  // Automatically switches to summary for large results
});
```

#### Reduce result count
```javascript
await search_entries_by_name({
  form_id: "123",
  search_text: "John", 
  max_results: 10      // Reduce from default 50
});
```

#### Use targeted searches
```javascript
// Instead of broad search
await search_entries_by_name({
  form_id: "123",
  search_text: "J"  // Too broad, returns many results
});

// Use specific searches
await search_entries_universal({
  form_id: "123",
  search_queries: [
    { text: "John Smith", field_types: ["name"] }  // More targeted
  ]
});
```

### 4. Field detection failures

**Symptoms:**
- All fields detected as "text" or "unknown"
- Low confidence scores (<0.5)
- Poor search results

**Diagnostic Steps:**
```javascript
const mappings = await get_field_mappings({ 
  form_id: "123", 
  include_details: true,
  refresh_cache: true  // Force fresh analysis
});

// Check confidence scores
Object.entries(mappings.fieldMappings).forEach(([fieldId, info]) => {
  if (info.confidence < 0.7) {
    console.log(`Low confidence: ${fieldId} - "${info.label}" (${info.confidence})`);
  }
});
```

**Solutions:**

#### Improve field labeling
```javascript
// Current poor labels
"Field 1", "Input", "Text", "Info", "Data"

// Better labels  
"First Name", "Last Name", "Email Address", "Team Members", "Phone Number"
```

#### Manual field targeting
```javascript
// Override auto-detection with manual targeting
await search_entries_universal({
  form_id: "123",
  search_queries: [
    { text: "John Smith", field_ids: ["52", "55"] }  // Manually specify name fields
  ]
});
```

#### Force cache refresh
```javascript
// Clear stale field mappings
await get_field_mappings({ 
  form_id: "123", 
  refresh_cache: true 
});
```

### 5. API connectivity issues

**Symptoms:**
- "Form not found" errors
- Authentication failures
- Network timeouts

**Diagnostic Steps:**
```javascript
// Test basic API connectivity
try {
  const forms = await get_forms({ form_id: "1" });
  console.log("✅ API working");
} catch (error) {
  console.log("❌ API error:", error.message);
}
```

**Solutions:**

#### Check environment variables
```bash
# Verify these are set correctly
echo $GRAVITY_FORMS_BASE_URL
echo $GRAVITY_FORMS_CONSUMER_KEY  
echo $GRAVITY_FORMS_CONSUMER_SECRET
```

#### Verify form exists
```javascript
// Test with known form ID
const forms = await get_forms();
console.log("Available forms:", forms.map(f => f.id));
```

#### Check API permissions
```bash
# Ensure API user has proper permissions:
# - Read access to forms
# - Read access to entries  
# - API access enabled in Gravity Forms settings
```

## Error Code Reference

### FORM_NOT_FOUND
**Cause**: Form ID doesn't exist or not accessible
**Solution**: Verify form ID and API permissions

### SEARCH_TEXT_REQUIRED  
**Cause**: Empty or missing search_text parameter
**Solution**: Provide non-empty search text

### FIELD_DETECTION_FAILED
**Cause**: Cannot analyze form structure  
**Solution**: Check form structure, try refresh_cache=true

### API_RATE_LIMIT
**Cause**: Too many API requests
**Solution**: Implement exponential backoff retry

### CACHE_ERROR
**Cause**: Cache system unavailable
**Solution**: System automatically falls back to direct API calls

## Performance Optimization

### Memory Usage Optimization

```bash
# For memory-constrained environments
FIELD_MAPPING_CACHE_MAX_SIZE=25               # Cache fewer forms
SEARCH_CACHE_MAX_SIZE=50                      # Cache fewer searches  
DEFAULT_MAX_RESULTS=15                        # Smaller result sets
```

### Speed Optimization

```bash
# For speed-critical applications
FIELD_MAPPING_CACHE_MAX_AGE_MS=7200000        # 2 hour cache
SEARCH_CACHE_MAX_AGE_MS=1800000               # 30 minute cache
PERFORMANCE_MONITORING_ENABLED=false         # Reduce monitoring overhead
```

### Accuracy vs Speed Tradeoffs

```javascript
// Fast but less accurate
await search_entries_by_name({
  form_id: "123",
  search_text: "John",
  strategy: "exact",      // Fastest strategy
  max_results: 10         // Smaller result set
});

// Slower but more accurate  
await search_entries_by_name({
  form_id: "123",
  search_text: "Jon",     // Typo in name
  strategy: "fuzzy",      // Handles misspellings
  max_results: 50         // More complete results
});
```

## Monitoring & Alerting

### Key Metrics to Monitor

```javascript
const health = await get_cache_status();

// Performance metrics
console.log('Average search time:', health.performance.averageSearchTime);
console.log('Error rate:', health.performance.errorRate);
console.log('Total searches:', health.performance.totalSearches);

// Cache effectiveness
console.log('Cache hit rate:', health.cacheHealth.fieldMappingCache.hitRate);
console.log('Memory usage:', health.cacheHealth.fieldMappingCache.memoryUsage);

// Alert thresholds
if (health.performance.averageSearchTime > 3000) {
  console.warn('⚠️ Search performance degraded');
}

if (health.performance.errorRate > 0.05) {
  console.warn('⚠️ High error rate detected');
}

if (health.cacheHealth.fieldMappingCache.hitRate < 0.5) {
  console.warn('⚠️ Poor cache effectiveness');
}
```

### Health Check Script

```javascript
// health-check.js - Run periodically to monitor system health
async function performHealthCheck() {
  const results = {
    timestamp: new Date().toISOString(),
    tests: []
  };
  
  try {
    // Test 1: API Connectivity
    const startTime = Date.now();
    await get_forms({ form_id: "1" });
    results.tests.push({
      name: "API Connectivity",
      status: "PASS",
      duration: Date.now() - startTime
    });
  } catch (error) {
    results.tests.push({
      name: "API Connectivity", 
      status: "FAIL",
      error: error.message
    });
  }
  
  try {
    // Test 2: Field Detection  
    const startTime = Date.now();
    await get_field_mappings({ form_id: "1" });
    results.tests.push({
      name: "Field Detection",
      status: "PASS", 
      duration: Date.now() - startTime
    });
  } catch (error) {
    results.tests.push({
      name: "Field Detection",
      status: "FAIL",
      error: error.message  
    });
  }
  
  try {
    // Test 3: Search Functionality
    const startTime = Date.now();
    await search_entries_by_name({ 
      form_id: "1", 
      search_text: "test",
      max_results: 1
    });
    results.tests.push({
      name: "Search Functionality",
      status: "PASS",
      duration: Date.now() - startTime
    });
  } catch (error) {
    results.tests.push({
      name: "Search Functionality", 
      status: "FAIL",
      error: error.message
    });
  }
  
  // Test 4: Cache Health
  const health = await get_cache_status();
  const cacheHealthy = health.cacheHealth.fieldMappingCache.hitRate > 0.3;
  results.tests.push({
    name: "Cache Health",
    status: cacheHealthy ? "PASS" : "WARN",
    details: {
      hitRate: health.cacheHealth.fieldMappingCache.hitRate,
      memoryUsage: health.cacheHealth.fieldMappingCache.memoryUsage
    }
  });
  
  console.log(JSON.stringify(results, null, 2));
  return results;
}

// Run health check
performHealthCheck().catch(console.error);
```

## Debug Mode

Enable debug mode for detailed troubleshooting:

```bash
# Environment variables for debugging
DEBUG_MODE=true
VERBOSE_LOGGING=true
FIELD_DETECTION_DEBUG=true
CACHE_DEBUG_LOGGING=true
SEARCH_TIMING_DEBUG=true
```

### Debug Output Examples

```javascript
// With debug mode enabled, you'll see:
[DEBUG] Field detection started for form 123
[DEBUG] Analyzing 45 fields...
[DEBUG] Name fields detected: 52, 55 (confidence: 0.95, 0.90)
[DEBUG] Email fields detected: 54 (confidence: 1.0)  
[DEBUG] Field detection completed in 234ms
[DEBUG] Cache miss for form 123, storing new mapping
[DEBUG] Search started: "John Smith" in form 123
[DEBUG] Using fields: 52, 55, 17 (name + team fields)
[DEBUG] API request: POST /entries/search
[DEBUG] API response: 156 entries found  
[DEBUG] Result processing: 3 matches with confidence >0.5
[DEBUG] Search completed in 1,247ms
```

## Support & Community

### Getting Help

1. **Check Documentation**: Review all guides in `/docs/` directory
2. **Run Diagnostics**: Use the health check and diagnostic commands above
3. **Enable Debug Mode**: Get detailed logs for troubleshooting
4. **Check Issues**: Review GitHub issues for similar problems

### Reporting Issues

When reporting issues, include:

```javascript
// System information
const health = await get_cache_status();
console.log('System Info:', {
  version: health.systemInfo.version,
  uptime: health.systemInfo.uptime,
  memoryUsage: health.systemInfo.memoryUsage,
  cacheHealth: health.cacheHealth,
  performance: health.performance
});

// Problem details
const problemDetails = {
  formId: "123",
  searchText: "problematic search",
  expectedBehavior: "should find John Smith in entry 456",
  actualBehavior: "returns no results", 
  errorMessages: "any error messages here",
  environment: "production/development"
};

console.log('Problem Details:', problemDetails);
```

This troubleshooting guide should help resolve most common issues with the Universal Search System.