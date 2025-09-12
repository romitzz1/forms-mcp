# Universal Search Configuration Guide

## Environment Variables

### Core API Configuration

```bash
# Gravity Forms API credentials (required)
GRAVITY_FORMS_BASE_URL=https://yoursite.com
GRAVITY_FORMS_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxx
GRAVITY_FORMS_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxx
GRAVITY_FORMS_AUTH_METHOD=basic
```

### Field Detection & Caching

```bash
# Field Mapping Cache Settings
FIELD_MAPPING_CACHE_ENABLED=true              # Enable field mapping cache
FIELD_MAPPING_CACHE_MAX_AGE_MS=3600000         # Cache expiry: 1 hour
FIELD_MAPPING_CACHE_MAX_SIZE=100               # Max forms to cache
FIELD_MAPPING_CACHE_PERSISTENCE=false         # SQLite persistence (optional)

# Search Results Cache
SEARCH_CACHE_ENABLED=true                     # Enable search result caching
SEARCH_CACHE_MAX_AGE_MS=900000                 # Cache expiry: 15 minutes
SEARCH_CACHE_MAX_SIZE=500                      # Max search results to cache
```

### Performance Monitoring

```bash
# Performance & Monitoring
PERFORMANCE_MONITORING_ENABLED=true           # Track performance metrics
PERFORMANCE_LOGGING_ENABLED=true              # Log performance data
PERFORMANCE_ALERT_THRESHOLD_MS=5000           # Alert if search > 5 seconds

# Advanced Features
FUZZY_MATCH_THRESHOLD=0.8                     # Fuzzy matching sensitivity
PHONETIC_MATCHING_ENABLED=true                # Enable soundex matching
MULTI_FORM_SEARCH_ENABLED=false               # Cross-form search (experimental)
```

### Response Management

```bash
# Token & Response Management
AUTO_SUMMARIZATION_THRESHOLD=20000            # Auto-summarize if > 20k tokens
MAX_RESPONSE_TOKENS=25000                     # Hard limit for responses
DEFAULT_MAX_RESULTS=50                        # Default search result limit
DETAILED_VIEW_THRESHOLD=10                    # Switch to summary if > 10 results
```

## Configuration Examples

### Development Environment

```bash
# .env.development
GRAVITY_FORMS_BASE_URL=https://dev-site.com
GRAVITY_FORMS_CONSUMER_KEY=ck_dev_key
GRAVITY_FORMS_CONSUMER_SECRET=cs_dev_secret

# Faster development with shorter cache times
FIELD_MAPPING_CACHE_MAX_AGE_MS=300000         # 5 minutes
SEARCH_CACHE_MAX_AGE_MS=60000                 # 1 minute

# More detailed logging for development
PERFORMANCE_LOGGING_ENABLED=true
PERFORMANCE_MONITORING_ENABLED=true
```

### Production Environment

```bash
# .env.production
GRAVITY_FORMS_BASE_URL=https://production-site.com
GRAVITY_FORMS_CONSUMER_KEY=ck_prod_key
GRAVITY_FORMS_CONSUMER_SECRET=cs_prod_secret

# Optimized for performance
FIELD_MAPPING_CACHE_MAX_AGE_MS=7200000        # 2 hours
SEARCH_CACHE_MAX_AGE_MS=1800000               # 30 minutes
FIELD_MAPPING_CACHE_MAX_SIZE=500              # Cache more forms

# Performance monitoring enabled
PERFORMANCE_MONITORING_ENABLED=true
PERFORMANCE_ALERT_THRESHOLD_MS=3000           # Alert if > 3 seconds
```

### High-Traffic Environment

```bash
# .env.high-traffic
# Aggressive caching for high-traffic scenarios
FIELD_MAPPING_CACHE_ENABLED=true
FIELD_MAPPING_CACHE_MAX_SIZE=1000             # Cache 1000 forms
FIELD_MAPPING_CACHE_PERSISTENCE=true         # Use SQLite for persistence

SEARCH_CACHE_ENABLED=true
SEARCH_CACHE_MAX_SIZE=2000                    # Cache 2000 search results
SEARCH_CACHE_MAX_AGE_MS=3600000               # 1 hour cache

# Conservative response management
DEFAULT_MAX_RESULTS=25                        # Smaller default results
AUTO_SUMMARIZATION_THRESHOLD=15000            # Earlier summarization
```

## Cache Configuration Details

### Field Mapping Cache

**Purpose**: Stores detected field types per form to avoid repeated analysis.

**Key Settings**:
- `MAX_AGE_MS`: How long to cache field mappings
- `MAX_SIZE`: Maximum number of forms to cache
- `PERSISTENCE`: Whether to use SQLite for persistent storage

**Tuning Guidelines**:
- **Forms change rarely**: Increase `MAX_AGE_MS` to 4+ hours
- **Limited memory**: Reduce `MAX_SIZE` to 50-100 forms
- **Server restarts**: Enable `PERSISTENCE` for cache survival

### Search Results Cache

**Purpose**: Caches recent search results for identical queries.

**Key Settings**:
- `MAX_AGE_MS`: How long to cache search results
- `MAX_SIZE`: Maximum number of cached search results

**Tuning Guidelines**:
- **Frequent repeated searches**: Increase cache size and age
- **Real-time data needs**: Reduce `MAX_AGE_MS` to 5-10 minutes
- **Memory constraints**: Limit `MAX_SIZE` to 100-200 results

## Performance Tuning

### Memory Usage Optimization

```bash
# For memory-constrained environments
FIELD_MAPPING_CACHE_MAX_SIZE=25               # Cache fewer forms
SEARCH_CACHE_MAX_SIZE=50                      # Cache fewer searches
DEFAULT_MAX_RESULTS=20                        # Smaller result sets
```

### Speed Optimization

```bash
# For speed-critical environments
FIELD_MAPPING_CACHE_MAX_AGE_MS=14400000       # 4 hour cache
SEARCH_CACHE_MAX_AGE_MS=1800000               # 30 minute cache
PERFORMANCE_MONITORING_ENABLED=false         # Reduce overhead
```

### Accuracy Optimization

```bash
# For accuracy-critical environments
FUZZY_MATCH_THRESHOLD=0.9                     # Stricter fuzzy matching
FIELD_MAPPING_CACHE_MAX_AGE_MS=1800000        # 30 minute cache (fresher data)
PHONETIC_MATCHING_ENABLED=true                # Enable all matching methods
```

## Monitoring & Alerts

### Health Check Endpoints

```javascript
// Check cache status and performance
const health = await get_cache_status();
console.log(health);

// Expected response:
{
  cacheHealth: {
    fieldMappingCache: {
      enabled: true,
      hitRate: 0.85,
      entryCount: 45,
      memoryUsage: "2.3MB"
    },
    searchResultsCache: {
      enabled: true,
      hitRate: 0.72,
      entryCount: 123,
      memoryUsage: "5.1MB"
    }
  },
  performance: {
    averageSearchTime: 890,  // milliseconds
    totalSearches: 1247,
    errorRate: 0.02
  }
}
```

### Performance Alerts

Set up monitoring for these key metrics:

```bash
# Response time alerts
PERFORMANCE_ALERT_THRESHOLD_MS=5000           # Alert if search > 5 seconds

# Memory usage alerts (custom implementation)
MEMORY_ALERT_THRESHOLD_MB=100                 # Alert if cache > 100MB

# Error rate alerts (custom implementation)  
ERROR_RATE_ALERT_THRESHOLD=0.05               # Alert if error rate > 5%
```

## Security Configuration

### API Key Management

```bash
# Use environment-specific keys
GRAVITY_FORMS_CONSUMER_KEY=${GF_CONSUMER_KEY}
GRAVITY_FORMS_CONSUMER_SECRET=${GF_CONSUMER_SECRET}

# Never commit keys to version control
# Use .env files or environment variable injection
```

### Rate Limiting

```bash
# Built-in rate limiting respect
API_RATE_LIMIT_ENABLED=true                   # Respect Gravity Forms rate limits
API_RATE_LIMIT_REQUESTS_PER_MINUTE=60         # Max requests per minute
API_RATE_LIMIT_BURST_SIZE=10                  # Allow burst requests
```

### Data Privacy

```bash
# Cache security
FIELD_MAPPING_CACHE_PERSISTENCE=false        # Disable persistent cache for sensitive data
SEARCH_CACHE_ENABLED=false                   # Disable search caching for privacy

# Logging controls
PERFORMANCE_LOGGING_ENABLED=false           # Disable performance logging
SEARCH_QUERY_LOGGING_ENABLED=false          # Disable search query logging
```

## Troubleshooting Configuration

### Debug Mode

```bash
# Enable debug mode for troubleshooting
DEBUG_MODE=true
VERBOSE_LOGGING=true
CACHE_DEBUG_LOGGING=true
FIELD_DETECTION_DEBUG=true
```

### Cache Issues

```bash
# If cache appears corrupted or stale
FIELD_MAPPING_CACHE_MAX_AGE_MS=0             # Force cache refresh
SEARCH_CACHE_MAX_AGE_MS=0                    # Force search cache refresh

# Or disable caching temporarily
FIELD_MAPPING_CACHE_ENABLED=false
SEARCH_CACHE_ENABLED=false
```

### Performance Issues

```bash
# If searches are slow
PERFORMANCE_MONITORING_ENABLED=true          # Enable monitoring
CACHE_STATISTICS_ENABLED=true                # Track cache effectiveness
API_TIMING_ENABLED=true                      # Track API call timing
```

## Configuration Validation

Create a configuration test script:

```javascript
// config-test.js
async function validateConfiguration() {
  try {
    // Test API connectivity
    const forms = await get_forms({ form_id: "1" });
    console.log("✅ API connectivity working");
    
    // Test cache functionality
    const mapping = await get_field_mappings({ form_id: "1" });
    console.log("✅ Field detection working");
    
    // Test search functionality
    const search = await search_entries_by_name({ 
      form_id: "1", 
      search_text: "test" 
    });
    console.log("✅ Universal search working");
    
    // Check cache status
    const health = await get_cache_status();
    console.log("✅ Cache status:", health.cacheHealth);
    
  } catch (error) {
    console.error("❌ Configuration error:", error.message);
  }
}

validateConfiguration();
```

## Best Practices

### Configuration Management

1. **Environment-Specific Configs**: Use separate `.env` files for dev/staging/prod
2. **Secure Key Storage**: Use environment variables or secure key management
3. **Version Control**: Never commit `.env` files with secrets
4. **Documentation**: Document any custom configuration changes

### Performance Monitoring

1. **Regular Health Checks**: Monitor cache hit rates and response times
2. **Alert Thresholds**: Set reasonable alert thresholds for your use case
3. **Capacity Planning**: Monitor memory usage and plan for growth
4. **Performance Baselines**: Establish baseline metrics for comparison

### Cache Strategy

1. **Cache Sizing**: Size caches based on actual form count and usage
2. **Cache Expiry**: Balance freshness needs with performance
3. **Cache Monitoring**: Regular cache effectiveness review
4. **Cache Invalidation**: Plan for manual cache clearing when needed

This configuration guide ensures optimal performance and reliability of the Universal Search System across different deployment scenarios.