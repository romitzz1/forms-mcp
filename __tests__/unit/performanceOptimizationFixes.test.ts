// ABOUTME: Tests for bug fixes in performance optimization components
// ABOUTME: Verifies that critical issues identified in fresh-eyes review are resolved

import { SearchResultsCache } from '../../utils/searchResultsCache';
import { PerformanceMonitor } from '../../utils/performanceMonitor';

describe('Performance Optimization Bug Fixes', () => {
    describe('Fix #1: Cache Strategy Key Collision', () => {
        it('should use resolved strategy for cache keys, not input strategy', () => {
            const cache = new SearchResultsCache();
            const mockResults = { matches: [], totalFound: 0, searchMetadata: { strategy: 'exact' } };
            
            // Store with resolved strategy 'exact'
            cache.set('form1', 'Jo', mockResults, 'exact');
            
            // Should be able to retrieve with same resolved strategy
            expect(cache.get('form1', 'Jo', 'exact')).toStrictEqual(mockResults);
            
            // Should NOT be retrievable with 'auto' strategy
            expect(cache.get('form1', 'Jo', 'auto')).toBeNull();
        });
    });

    describe('Fix #2: LRU Access Order Corruption Risk', () => {
        it('should handle missing accessOrder keys gracefully', () => {
            const cache = new SearchResultsCache({ maxSize: 2, enableLogging: false });
            const mockResults = { matches: [], totalFound: 0, searchMetadata: {} };

            // Fill cache to capacity
            cache.set('form1', 'query1', mockResults);
            cache.set('form2', 'query2', mockResults);
            
            // Manually simulate corruption by clearing accessOrder (simulates expired entry cleanup)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            (cache as any).accessOrder = [];
            
            // Adding new entry should trigger eviction and handle empty accessOrder
            expect(() => {
                cache.set('form3', 'query3', mockResults);
            }).not.toThrow();
            
            // Cache should still be functional
            expect(cache.size()).toBeLessThanOrEqual(2);
        });
    });

    describe('Fix #3: Type Consistency', () => {
        it('should have consistent IMemoryUsage type in PerformanceMonitor', () => {
            const monitor = new PerformanceMonitor();
            
            const summary = monitor.getSummary();
            const memUsage = summary.memoryUsage;
            
            // Should have all expected memory properties
            expect(typeof memUsage.heapUsed).toBe('number');
            expect(typeof memUsage.heapTotal).toBe('number');
            expect(typeof memUsage.external).toBe('number');
            expect(typeof memUsage.rss).toBe('number');
        });
    });

    describe('Fix #4: Memory Calculation Performance', () => {
        it('should not use expensive JSON.stringify for memory calculation', () => {
            const cache = new SearchResultsCache({ enableLogging: false });
            const mockResults = { matches: [], totalFound: 0, searchMetadata: {} };
            
            // Add some entries
            for (let i = 0; i < 10; i++) {
                cache.set(`form${i}`, `query${i}`, mockResults);
            }
            
            // Multiple stats calls should be fast (no JSON.stringify)
            const start = Date.now();
            for (let i = 0; i < 100; i++) {
                cache.getCacheStatsRaw(); // Use side-effect-free version
            }
            const duration = Date.now() - start;
            
            // Should be very fast - under 50ms for 100 calls
            expect(duration).toBeLessThan(50);
        });
    });

    describe('Fix #5: Environment Variable Safety', () => {
        it('should handle invalid environment variables gracefully', () => {
            // Test with invalid env vars
            const originalEnv = process.env.SEARCH_CACHE_MAX_SIZE;
            process.env.SEARCH_CACHE_MAX_SIZE = 'not-a-number';
            
            expect(() => {
                const cache = new SearchResultsCache();
                expect(cache.options.maxSize).toBeGreaterThan(0); // Should use default
            }).not.toThrow();
            
            // Restore env
            if (originalEnv !== undefined) {
                process.env.SEARCH_CACHE_MAX_SIZE = originalEnv;
            } else {
                delete process.env.SEARCH_CACHE_MAX_SIZE;
            }
        });
    });

    describe('Fix #6: Side-Effect-Free Stats', () => {
        it('should provide stats method without side effects', async () => {
            const cache = new SearchResultsCache({ maxAge: 100 }); // Short expiry
            const mockResults = { matches: [], totalFound: 0, searchMetadata: {} };
            
            cache.set('form1', 'query1', mockResults);
            
            // Wait for expiry
            await new Promise(resolve => {
                setTimeout(() => {
                    const sizeBefore = cache.size();
                    
                    // getCacheStatsRaw should not trigger cleanup
                    cache.getCacheStatsRaw();
                    const sizeAfterRaw = cache.size();
                    
                    // Regular getCacheStats should trigger cleanup
                    cache.getCacheStats();
                    const sizeAfterCleanup = cache.size();
                    
                    expect(sizeBefore).toBe(1);
                    expect(sizeAfterRaw).toBe(1); // No cleanup
                    expect(sizeAfterCleanup).toBe(0); // Cleanup occurred
                    
                    resolve(void 0);
                }, 150);
            });
        });
    });

    describe('Fix #7: Options Immutability', () => {
        it('should not mutate readonly options after construction', () => {
            const cache = new SearchResultsCache({ maxSize: 50 });
            
            // Options should remain unchanged regardless of environment
            expect(cache.options.maxSize).toBe(50);
            
            // Even if caching is disabled via environment, options should not change
            const originalEnv = process.env.SEARCH_CACHE_ENABLED;
            process.env.SEARCH_CACHE_ENABLED = 'false';
            
            const cache2 = new SearchResultsCache({ maxSize: 100 });
            expect(cache2.options.maxSize).toBe(100); // Options unchanged
            
            // But caching should still be disabled
            cache2.set('test', 'test', { matches: [], totalFound: 0, searchMetadata: {} });
            expect(cache2.size()).toBe(0); // No entries stored
            
            // Restore env
            if (originalEnv !== undefined) {
                process.env.SEARCH_CACHE_ENABLED = originalEnv;
            } else {
                delete process.env.SEARCH_CACHE_ENABLED;
            }
        });
    });
});