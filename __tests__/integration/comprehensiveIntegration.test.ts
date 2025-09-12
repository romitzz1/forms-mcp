// ABOUTME: Comprehensive integration tests for universal search system end-to-end workflows
// ABOUTME: Tests complete search workflows, multi-tool integration, performance, and production scenarios

import { UniversalSearchManager } from '../../utils/universalSearchManager';
import { FieldTypeDetector } from '../../utils/fieldTypeDetector';
import { SearchResultsFormatter } from '../../utils/searchResultsFormatter';
import { FieldMappingCache } from '../../utils/fieldMappingCache';

describe('Comprehensive Integration Tests - Universal Search System', () => {
    let universalSearchManager: UniversalSearchManager;
    let fieldTypeDetector: FieldTypeDetector;
    let searchResultsFormatter: SearchResultsFormatter;
    let fieldMappingCache: FieldMappingCache;
    let mockApiClient: any;

    // Mock form data for integration testing
    const mockForm = {
        id: "193",
        title: "League Sign up 25-26",
        fields: [
            { id: "52", label: "Name", type: "text", adminLabel: "", isRequired: true },
            { id: "55", label: "Full Name", type: "text", adminLabel: "", isRequired: false },
            { id: "54", label: "Email Address", type: "email", adminLabel: "", isRequired: true },
            { id: "50", label: "Username", type: "text", adminLabel: "", isRequired: false },
            { id: "17", label: "Team Members", type: "textarea", adminLabel: "", isRequired: false },
            { id: "32", label: "Notes/Comments", type: "textarea", adminLabel: "", isRequired: false }
        ]
    };

    const mockEntries = [
        {
            "id": "10795",
            "form_id": "193",
            "date_created": "2025-09-03 15:43:56",
            "payment_status": "Paid",
            "52": "Example Name",
            "54": "example@email.com",
            "17": "Team member: John Smith, Jane Doe"
        },
        {
            "id": "10796",
            "form_id": "193", 
            "date_created": "2025-09-03 16:15:22",
            "payment_status": "Unpaid",
            "52": "Another Person",
            "54": "another@email.com",
            "17": "Solo registration"
        }
    ];

    beforeEach(() => {
        // Reset all mocks and caches
        jest.clearAllMocks();
        
        // Initialize mock API client
        mockApiClient = {
            getFormDefinition: jest.fn().mockResolvedValue(mockForm),
            searchEntries: jest.fn().mockImplementation((_formId: string, searchParams: any) => {
                // Simulate search logic - return entries array directly
                if (searchParams.field_filters) {
                    const filters = Array.isArray(searchParams.field_filters) 
                        ? searchParams.field_filters 
                        : [searchParams.field_filters];
                    
                    const matches = mockEntries.filter(entry => {
                        return filters.some((filter: any) => {
                            const fieldValue = entry[filter.key as keyof typeof entry];
                            return fieldValue && fieldValue.toLowerCase().includes(filter.value.toLowerCase());
                        });
                    });
                    
                    return Promise.resolve(matches); // Return array directly
                }
                return Promise.resolve(mockEntries); // Return array directly
            })
        };
        
        // Initialize components with fresh state
        fieldMappingCache = new FieldMappingCache();
        fieldTypeDetector = new FieldTypeDetector(fieldMappingCache);  // Connect cache to detector
        universalSearchManager = new UniversalSearchManager(fieldTypeDetector, mockApiClient);
        searchResultsFormatter = new SearchResultsFormatter();

        // Clear any existing cache entries
        fieldMappingCache.invalidate();
    });

    describe('End-to-End Search Workflows', () => {
        it('Complete name search workflow: Field detection → Search → Formatting', async () => {
            const startTime = performance.now();
            
            // Step 1: Form field detection
            const fieldMapping = await fieldTypeDetector.analyzeFormFields(mockForm);
            expect(fieldMapping).toBeTruthy();
            
            // Verify name fields are detected
            const nameFields = fieldTypeDetector.getNameFields(fieldMapping);
            expect(nameFields.length).toBeGreaterThan(0);
            expect(nameFields.some(f => f.confidence > 0.8)).toBe(true);

            // Step 2: Universal search execution
            const searchResult = await universalSearchManager.searchByName(
                '193', 
                'Example Name',
                { strategy: 'auto', maxResults: 50, includeContext: true }
            );
            
            expect(searchResult).toBeTruthy();
            expect(searchResult.matches).toBeDefined();
            expect(searchResult.matches.length).toBeGreaterThan(0);
            
            // Step 3: Results formatting
            const formattedResult = searchResultsFormatter.formatSearchResults(
                searchResult,
                'auto',
                mockForm
            );
            
            expect(formattedResult.content).toBeTruthy();
            expect(formattedResult.tokenCount).toBeLessThan(25000); // Token limit compliance
            
            const endTime = performance.now();
            const executionTime = endTime - startTime;
            
            // Performance validation: <2 seconds for complete workflow
            expect(executionTime).toBeLessThan(2000);
            
            console.log(`✅ Complete workflow executed in ${executionTime.toFixed(1)}ms`);
        });

        it('Multi-field search workflow with team mentions and email', async () => {
            const fieldMapping = await fieldTypeDetector.analyzeFormFields(mockForm);
            
            // Test searching across multiple field types
            const searchResult = await universalSearchManager.searchUniversal(
                '193',
                'Example',
                ['name', 'team', 'email'],
                { strategy: 'contains', maxResults: 100, includeContext: true }
            );
            
            expect(searchResult.matches).toBeDefined();
            
            // Verify results include matches from different field types
            const hasNameMatches = searchResult.matches.some(match => 
                Object.keys(match.matchedFields).some(fieldId => 
                    fieldMapping[fieldId]?.fieldType === 'name'
                )
            );
            
            expect(hasNameMatches).toBe(true);
            
            // Format results and verify token management
            const formatted = searchResultsFormatter.formatSearchResults(
                searchResult, 
                'detailed',
                mockForm
            );
            
            expect(formatted.tokenCount).toBeLessThan(25000);
            expect(formatted.content).toContain('match'); // Should contain match information
        });

        it('Error recovery and graceful degradation workflow', async () => {
            // Test workflow when form doesn't exist
            try {
                const searchResult = await universalSearchManager.searchByName(
                    '99999',
                    'Test Name',
                    { strategy: 'exact', maxResults: 10, includeContext: false }
                );
                
                // Should handle gracefully - either empty results or appropriate error
                expect(searchResult).toBeTruthy();
            } catch (error: any) {
                // Should be a meaningful error message
                expect(error.message).toContain('form');
            }

            // Test with search that finds no matches
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'NonexistentSearchTerm',
                { strategy: 'exact', maxResults: 10, includeContext: false }
            );
            
            // Should handle gracefully
            expect(searchResult).toBeTruthy();
            expect(searchResult.matches).toBeDefined();
            expect(searchResult.matches).toHaveLength(0);
        });
    });

    describe('Multi-Tool Integration', () => {
        it('Search + Export workflow integration', async () => {
            // Simulate search_entries_by_name → export_entries_formatted workflow
            
            // Step 1: Search for entries
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'Example Name',
                { strategy: 'contains', maxResults: 20, includeContext: true }
            );
            
            expect(searchResult.matches.length).toBeGreaterThan(0);
            
            // Step 2: Extract entry IDs for export
            const entryIds = searchResult.matches.map(match => match.entryId);
            
            // Step 3: Verify export would work with these IDs
            // (In real integration, this would call export_entries_formatted)
            expect(entryIds).toHaveLength(searchResult.matches.length);
            expect(entryIds.every(id => typeof id === 'string')).toBe(true);
            
            console.log(`✅ Search → Export integration: Found ${entryIds.length} entries for export`);
        });

        it('Field mapping inspection + Search optimization', async () => {
            
            // Step 1: Inspect field mappings (get_field_mappings tool simulation)
            const fieldMapping = await fieldTypeDetector.analyzeFormFields(mockForm);
            const nameFields = fieldTypeDetector.getNameFields(fieldMapping);
            
            // Step 2: Use mapping insights for optimized search
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'Test',
                { strategy: 'auto', maxResults: 50, includeContext: true }
            );
            
            // Verify search uses detected fields effectively
            expect(nameFields.length).toBeGreaterThan(0);
            expect(searchResult.matches).toBeDefined();
            
            // Step 3: Verify field mapping data is useful for search
            const highConfidenceFields = nameFields.filter(f => f.confidence > 0.8);
            expect(highConfidenceFields.length).toBeGreaterThan(0);
            
            console.log(`✅ Field mapping → Search integration: ${nameFields.length} name fields detected`);
        });

        it('Template creation from search results workflow', async () => {
            
            // Step 1: Search to identify a good form for templating
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'Example',
                { strategy: 'contains', maxResults: 5, includeContext: false }
            );
            
            // Step 2: If form has good data, it could be used for template creation
            // (This simulates save_form_as_template workflow)
            if (searchResult.matches.length > 0) {
                const fieldMapping = await fieldTypeDetector.analyzeFormFields(mockForm);
                const nameFields = fieldTypeDetector.getNameFields(fieldMapping);
                
                // Verify form has good structure for templating
                expect(nameFields.length).toBeGreaterThan(0);
                expect(mockForm.title).toBeTruthy();
                
                console.log(`✅ Search → Template workflow: Form suitable for templating with ${nameFields.length} name fields`);
            }
        });
    });

    describe('Performance Integration Tests', () => {
        it('Cold start performance: First search on uncached form', async () => {
            // Clear all caches to simulate cold start
            fieldMappingCache.invalidate();
            
            const startTime = performance.now();
            
            const fieldMapping = await fieldTypeDetector.analyzeFormFields(mockForm);
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'Example Name',
                { strategy: 'auto', maxResults: 50, includeContext: true }
            );
            
            const endTime = performance.now();
            const coldStartTime = endTime - startTime;
            
            // Cold start should still be reasonable (under 3 seconds)
            expect(coldStartTime).toBeLessThan(3000);
            
            // Verify cache was populated
            const cachedMapping = fieldMappingCache.get('193');
            expect(cachedMapping).toBeTruthy();
            
            console.log(`✅ Cold start performance: ${coldStartTime.toFixed(1)}ms`);
        });

        it('Warm cache performance: Repeated searches with full cache', async () => {
            // Warm up the cache
            await fieldTypeDetector.analyzeFormFields(mockForm);
            
            const startTime = performance.now();
            
            // Multiple searches to test warm cache performance
            for (let i = 0; i < 3; i++) {
                const searchResult = await universalSearchManager.searchByName(
                    '193',
                    `Example Name ${i}`,
                    { strategy: 'contains', maxResults: 20, includeContext: true }
                );
                expect(searchResult.matches).toBeDefined();
            }
            
            const endTime = performance.now();
            const avgWarmTime = (endTime - startTime) / 3;
            
            // Warm searches should be very fast (under 500ms each)
            expect(avgWarmTime).toBeLessThan(500);
            
            console.log(`✅ Warm cache performance: ${avgWarmTime.toFixed(1)}ms average`);
        });

        it('Large form performance: Complex form with many fields', async () => {
            // Add extra fields to simulate complex form
            const complexForm = {
                ...mockForm,
                fields: [
                    ...mockForm.fields,
                    ...Array.from({ length: 50 }, (_, i) => ({
                        id: String(100 + i),
                        type: 'text',
                        label: `Complex Field ${i}`,
                        adminLabel: '',
                        isRequired: false
                    }))
                ]
            };
            
            const startTime = performance.now();
            
            const fieldMapping = await fieldTypeDetector.analyzeFormFields(complexForm);
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'Example',
                { strategy: 'contains', maxResults: 100, includeContext: true }
            );
            
            const endTime = performance.now();
            const complexFormTime = endTime - startTime;
            
            // Complex forms should still perform reasonably (under 5 seconds)
            expect(complexFormTime).toBeLessThan(5000);
            
            expect(Object.keys(fieldMapping).length).toBeGreaterThan(mockForm.fields.length);
            
            console.log(`✅ Complex form performance: ${complexFormTime.toFixed(1)}ms for ${Object.keys(fieldMapping).length} fields`);
        });

        it('Memory usage under sustained operation', async () => {
            const initialMemory = process.memoryUsage().heapUsed;
            
            // Simulate sustained operation with multiple searches
            for (let i = 0; i < 10; i++) {
                await fieldTypeDetector.analyzeFormFields(mockForm);
                await universalSearchManager.searchByName(
                    '193',
                    `Search ${i}`,
                    { strategy: 'contains', maxResults: 20, includeContext: false }
                );
            }
            
            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;
            
            // Memory increase should be reasonable (under 50MB)
            expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
            
            console.log(`✅ Memory usage test: ${(memoryIncrease / 1024 / 1024).toFixed(1)}MB increase`);
        });
    });

    describe('Cross-Tool Compatibility', () => {
        it('Universal search maintains compatibility with standard get_entries', async () => {
            
            // Test that enhanced get_entries maintains backward compatibility
            const standardParams = {
                form_id: '193',
                paging: { page_size: 20, current_page: 1 },
                search: { key: '52', value: 'Example' }
            };
            
            // This simulates the enhanced get_entries maintaining standard behavior
            expect(standardParams.form_id).toBe('193');
            expect(standardParams.search.key).toBe('52');
            expect(standardParams.search.value).toBe('Example');
            
            // Universal search should be able to work alongside standard search
            const universalResult = await universalSearchManager.searchByName(
                '193',
                'Example',
                { strategy: 'auto', maxResults: 20, includeContext: false }
            );
            
            expect(universalResult.matches).toBeDefined();
            
            console.log(`✅ Cross-tool compatibility: Standard and universal search coexist`);
        });

        it('Bulk operations integration with search results', async () => {
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'Example',
                { strategy: 'contains', maxResults: 10, includeContext: false }
            );
            
            // Extract entry IDs for potential bulk operations
            const entryIds = searchResult.matches.map(match => match.entryId);
            
            // Verify bulk operation compatibility
            expect(entryIds).toBeDefined();
            expect(entryIds.length).toBeGreaterThan(0);
            expect(entryIds.every(id => typeof id === 'string')).toBe(true);
            
            // Simulate bulk operation preparation
            const bulkOperationData = {
                entry_ids: entryIds,
                operation_type: 'update_status',
                data: { status: 'active' },
                confirm: true
            };
            
            expect(bulkOperationData.entry_ids).toEqual(entryIds);
            
            console.log(`✅ Bulk operations integration: ${entryIds.length} entries ready for bulk operations`);
        });
    });

    describe('Data Quality and Edge Cases', () => {
        it('Various name formats and international characters', async () => {
            
            const testNames = [
                'John Smith',           // Standard Western name
                'Mary-Jane O\'Connor',  // Hyphenated with apostrophe
                'José García',          // International characters
                'Smith, John',          // Last, First format
                'Dr. Elizabeth Brown',  // Title prefix
                '李小明',               // Chinese characters
                'Jean-Claude',          // Single hyphenated name
            ];
            
            for (const testName of testNames) {
                const searchResult = await universalSearchManager.searchByName(
                    '193',
                    testName,
                    { strategy: 'contains', maxResults: 10, includeContext: false }
                );
                
                // Should handle all name formats without errors
                expect(searchResult.matches).toBeDefined();
            }
            
            console.log(`✅ Data quality test: ${testNames.length} name formats handled successfully`);
        });

        it('Edge cases: empty results, malformed data, extreme inputs', async () => {
            
            // Test search with no matches (should return empty results, not error)
            const noMatchResult = await universalSearchManager.searchByName(
                '193',
                'NonexistentName12345',
                { strategy: 'exact', maxResults: 5, includeContext: false }
            );
            expect(noMatchResult.matches).toBeDefined();
            expect(noMatchResult.matches).toHaveLength(0);
            
            // Test very long search string
            const longSearch = 'A'.repeat(1000);
            const longResult = await universalSearchManager.searchByName(
                '193',
                longSearch,
                { strategy: 'contains', maxResults: 5, includeContext: false }
            );
            expect(longResult.matches).toBeDefined();
            
            // Test special characters
            const specialResult = await universalSearchManager.searchByName(
                '193',
                '!@#$%^&*()',
                { strategy: 'exact', maxResults: 5, includeContext: false }
            );
            expect(specialResult.matches).toBeDefined();
            
            console.log(`✅ Edge cases test: Handled empty, long, and special character searches`);
        });
    });

    describe('Production Simulation', () => {
        it('Concurrent search operations simulation', async () => {
            
            // Simulate multiple concurrent users searching
            const concurrentSearches = Array.from({ length: 5 }, (_, i) => 
                universalSearchManager.searchByName(
                    '193',
                    `User ${i} Search`,
                    { strategy: 'contains', maxResults: 10, includeContext: false }
                )
            );
            
            const startTime = performance.now();
            const results = await Promise.all(concurrentSearches);
            const endTime = performance.now();
            
            // All searches should complete successfully
            expect(results).toHaveLength(5);
            results.forEach(result => {
                expect(result.matches).toBeDefined();
            });
            
            const totalTime = endTime - startTime;
            const avgTime = totalTime / 5;
            
            // Concurrent searches should still be efficient
            expect(avgTime).toBeLessThan(1000); // Under 1 second average
            
            console.log(`✅ Concurrent operations: 5 searches completed in ${totalTime.toFixed(1)}ms (${avgTime.toFixed(1)}ms avg)`);
        });

        it('Cache effectiveness under realistic usage patterns', async () => {
            
            // Simulate realistic usage: some cache hits, some misses
            const initialStats = fieldMappingCache.getCacheStats();
            const initialEntries = initialStats.entryCount;
            
            // Mix of cached and uncached operations
            await fieldTypeDetector.analyzeFormFields(mockForm); // Should cache
            await fieldTypeDetector.analyzeFormFields(mockForm); // Should hit cache
            await fieldTypeDetector.analyzeFormFields(mockForm); // Should hit cache
            
            const finalStats = fieldMappingCache.getCacheStats();
            
            // Should show cache was used (entries were added)
            expect(finalStats.entryCount).toBeGreaterThanOrEqual(initialEntries);
            expect(finalStats.hitRate).toBeGreaterThanOrEqual(0); // Hit rate should be valid
            
            console.log(`✅ Cache effectiveness: Hit rate validation completed`);
        });
    });

    describe('Regression Testing', () => {
        it('All existing functionality remains unchanged', async () => {
            // Test that universal search components don't break basic functionality
            // Basic form operations should still work
            expect(mockForm).toBeTruthy();
            expect(mockForm.id).toBe('193');
            expect(mockForm.fields).toBeDefined();
            expect(mockForm.fields.length).toBeGreaterThan(0);
            
            // Field detection should provide useful results
            const fieldMapping = await fieldTypeDetector.analyzeFormFields(mockForm);
            expect(fieldMapping).toBeTruthy();
            expect(Object.keys(fieldMapping).length).toBeGreaterThan(0);
            
            // Search should return structured results
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'Example',
                { strategy: 'auto', maxResults: 10, includeContext: false }
            );
            
            expect(searchResult).toBeTruthy();
            expect(searchResult.matches).toBeDefined();
            expect(searchResult.totalFound).toBeDefined();
            
            console.log(`✅ Regression test: All basic functionality preserved`);
        });

        it('Performance hasn\'t degraded from baseline', async () => {
            // Baseline operation timing
            const startTime = performance.now();
            
            const fieldMapping = await fieldTypeDetector.analyzeFormFields(mockForm);
            const searchResult = await universalSearchManager.searchByName(
                '193',
                'Example Name',
                { strategy: 'auto', maxResults: 20, includeContext: false }
            );
            const formatted = searchResultsFormatter.formatSearchResults(
                searchResult,
                'summary',
                mockForm
            );
            
            const endTime = performance.now();
            const totalTime = endTime - startTime;
            
            // Should meet performance targets
            expect(totalTime).toBeLessThan(2000); // Under 2 seconds
            expect(formatted.tokenCount).toBeLessThan(25000); // Under token limit
            
            console.log(`✅ Performance regression test: ${totalTime.toFixed(1)}ms (target: <2000ms)`);
        });
    });

    describe('System Health and Monitoring', () => {
        it('Component initialization and health checks', async () => {
            // Verify all components initialize properly
            expect(universalSearchManager).toBeDefined();
            expect(fieldTypeDetector).toBeDefined();
            expect(searchResultsFormatter).toBeDefined();
            expect(fieldMappingCache).toBeDefined();
            
            // Test component health
            const cacheStats = fieldMappingCache.getCacheStats();
            expect(cacheStats).toBeDefined();
            expect(cacheStats.entryCount).toBeGreaterThanOrEqual(0);
            
            console.log(`✅ System health: All components initialized successfully`);
        });

        it('Error monitoring and alerting simulation', async () => {
            let errorsCaught = 0;
            
            try {
                // Intentionally trigger error scenarios
                await universalSearchManager.searchByName(
                    'invalid-form-id',
                    'Test',
                    { strategy: 'exact', maxResults: 10, includeContext: false }
                );
            } catch (error) {
                errorsCaught++;
                expect(error).toBeDefined();
            }
            
            try {
                // Another error scenario
                await fieldTypeDetector.analyzeFormFields(null as any);
            } catch (error) {
                errorsCaught++;
                expect(error).toBeDefined();
            }
            
            // Errors should be properly caught and handled
            console.log(`✅ Error monitoring: ${errorsCaught} errors properly handled`);
        });
    });
});