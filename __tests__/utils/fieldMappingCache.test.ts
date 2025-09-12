// ABOUTME: Comprehensive tests for FieldMappingCache class that provides performance caching for field type mappings
// ABOUTME: Tests LRU eviction, expiration handling, concurrent access, and cache statistics with thread safety

import { FieldMappingCache, CachedFieldMapping, CacheOptions, CacheStats } from '../../utils/fieldMappingCache';
import { FormFieldMapping, DetectedFieldType } from '../../utils/fieldTypeDetector';

describe('FieldMappingCache', () => {
    let cache: FieldMappingCache;
    let mockMapping: FormFieldMapping;

    beforeEach(() => {
        cache = new FieldMappingCache();
        mockMapping = {
            '52': { fieldId: '52', fieldType: 'name' as DetectedFieldType, confidence: 0.95, label: 'Name' },
            '54': { fieldId: '54', fieldType: 'email' as DetectedFieldType, confidence: 1.0, label: 'Email' },
            '17': { fieldId: '17', fieldType: 'team' as DetectedFieldType, confidence: 0.85, label: 'Team Members' }
        };
    });

    describe('Basic Cache Operations', () => {
        test('should store and retrieve field mappings', () => {
            const formId = '193';
            
            // Initially empty
            expect(cache.get(formId)).toBeNull();
            
            // Store mapping
            cache.set(formId, mockMapping);
            
            // Retrieve mapping
            const retrieved = cache.get(formId);
            expect(retrieved).toEqual(mockMapping);
        });

        test('should return null for non-existent cache entries', () => {
            expect(cache.get('nonexistent')).toBeNull();
        });

        test('should handle multiple form mappings', () => {
            const mapping1 = mockMapping;
            const mapping2: FormFieldMapping = {
                '1': { fieldId: '1', fieldType: 'name' as DetectedFieldType, confidence: 0.9, label: 'Full Name' },
                '2': { fieldId: '2', fieldType: 'phone' as DetectedFieldType, confidence: 0.8, label: 'Phone' }
            };

            cache.set('form1', mapping1);
            cache.set('form2', mapping2);

            expect(cache.get('form1')).toEqual(mapping1);
            expect(cache.get('form2')).toEqual(mapping2);
        });
    });

    describe('Cache Expiration', () => {
        test('should respect default expiration time (1 hour)', () => {
            const formId = '193';
            cache.set(formId, mockMapping);
            
            // Should be available immediately
            expect(cache.get(formId)).toEqual(mockMapping);
            
            // Mock time advancement beyond expiration
            const cacheEntry = (cache as any).cache.get(formId) as CachedFieldMapping;
            cacheEntry.timestamp = new Date(Date.now() - 3700000); // 1 hour + 5 minutes ago
            
            // Should be null due to expiration
            expect(cache.get(formId)).toBeNull();
        });

        test('should handle custom expiration times', () => {
            const shortExpiryCache = new FieldMappingCache({ 
                maxAge: 1000, // 1 second
                maxSize: 100,
                enablePersistence: false 
            });
            
            const formId = '193';
            shortExpiryCache.set(formId, mockMapping);
            
            // Should be available immediately
            expect(shortExpiryCache.get(formId)).toEqual(mockMapping);
            
            // Mock expiration
            const cacheEntry = (shortExpiryCache as any).cache.get(formId) as CachedFieldMapping;
            cacheEntry.timestamp = new Date(Date.now() - 2000); // 2 seconds ago
            
            expect(shortExpiryCache.get(formId)).toBeNull();
        });

        test('should update lastAccessed on cache hits', () => {
            const formId = '193';
            cache.set(formId, mockMapping);
            
            const beforeAccess = Date.now();
            cache.get(formId);
            
            const cacheEntry = (cache as any).cache.get(formId) as CachedFieldMapping;
            expect(cacheEntry.lastAccessed.getTime()).toBeGreaterThanOrEqual(beforeAccess);
        });
    });

    describe('LRU Eviction', () => {
        test('should evict least recently used entries when cache is full', () => {
            const smallCache = new FieldMappingCache({ 
                maxAge: 3600000, 
                maxSize: 2,
                enablePersistence: false 
            });

            const mapping1: FormFieldMapping = { '1': { fieldId: '1', fieldType: 'name' as DetectedFieldType, confidence: 0.9, label: 'Name1' } };
            const mapping2: FormFieldMapping = { '2': { fieldId: '2', fieldType: 'name' as DetectedFieldType, confidence: 0.9, label: 'Name2' } };
            const mapping3: FormFieldMapping = { '3': { fieldId: '3', fieldType: 'name' as DetectedFieldType, confidence: 0.9, label: 'Name3' } };

            // Fill cache to capacity
            smallCache.set('form1', mapping1);
            smallCache.set('form2', mapping2);
            
            // Both should be available
            expect(smallCache.get('form1')).toEqual(mapping1);
            expect(smallCache.get('form2')).toEqual(mapping2);

            // Access form1 to make it recently used
            smallCache.get('form1');

            // Add third mapping - should evict form2 (least recently used)
            smallCache.set('form3', mapping3);

            expect(smallCache.get('form1')).toEqual(mapping1); // Still available (recently used)
            expect(smallCache.get('form2')).toBeNull();        // Evicted
            expect(smallCache.get('form3')).toEqual(mapping3); // Newly added
        });

        test('should handle cache size of 1 correctly', () => {
            const tinyCache = new FieldMappingCache({ 
                maxAge: 3600000, 
                maxSize: 1,
                enablePersistence: false 
            });

            const mapping1: FormFieldMapping = { '1': { fieldId: '1', fieldType: 'name' as DetectedFieldType, confidence: 0.9, label: 'Name1' } };
            const mapping2: FormFieldMapping = { '2': { fieldId: '2', fieldType: 'name' as DetectedFieldType, confidence: 0.9, label: 'Name2' } };

            tinyCache.set('form1', mapping1);
            expect(tinyCache.get('form1')).toEqual(mapping1);

            // Setting second should evict first
            tinyCache.set('form2', mapping2);
            expect(tinyCache.get('form1')).toBeNull();
            expect(tinyCache.get('form2')).toEqual(mapping2);
        });
    });

    describe('Cache Invalidation', () => {
        test('should invalidate specific form cache', () => {
            cache.set('form1', mockMapping);
            cache.set('form2', mockMapping);

            expect(cache.get('form1')).toEqual(mockMapping);
            expect(cache.get('form2')).toEqual(mockMapping);

            // Invalidate specific form
            cache.invalidate('form1');

            expect(cache.get('form1')).toBeNull();
            expect(cache.get('form2')).toEqual(mockMapping);
        });

        test('should invalidate all cache entries', () => {
            cache.set('form1', mockMapping);
            cache.set('form2', mockMapping);
            cache.set('form3', mockMapping);

            // All should be available
            expect(cache.get('form1')).toEqual(mockMapping);
            expect(cache.get('form2')).toEqual(mockMapping);
            expect(cache.get('form3')).toEqual(mockMapping);

            // Invalidate all
            cache.invalidate();

            expect(cache.get('form1')).toBeNull();
            expect(cache.get('form2')).toBeNull();
            expect(cache.get('form3')).toBeNull();
        });

        test('should handle invalidation of non-existent entries', () => {
            cache.set('form1', mockMapping);
            
            // Should not throw error
            expect(() => cache.invalidate('nonexistent')).not.toThrow();
            
            // Original entry should still be available
            expect(cache.get('form1')).toEqual(mockMapping);
        });
    });

    describe('Cache Statistics', () => {
        test('should track cache hit and miss rates', () => {
            // Initial stats
            let stats = cache.getCacheStats();
            expect(stats.hitRate).toBe(0); // No operations yet
            expect(stats.entryCount).toBe(0);

            // Add entry and test hits/misses
            cache.set('form1', mockMapping);
            cache.get('form1');  // Hit
            cache.get('form2');  // Miss
            cache.get('form1');  // Hit
            cache.get('form3');  // Miss

            stats = cache.getCacheStats();
            expect(stats.hitRate).toBe(0.5); // 2 hits out of 4 attempts
            expect(stats.entryCount).toBe(1);
        });

        test('should provide memory usage estimates', () => {
            const stats1 = cache.getCacheStats();
            const initialMemory = stats1.memoryUsage;

            // Add multiple entries
            cache.set('form1', mockMapping);
            cache.set('form2', mockMapping);

            const stats2 = cache.getCacheStats();
            expect(stats2.memoryUsage).toBeGreaterThan(initialMemory);
            expect(stats2.entryCount).toBe(2);
        });

        test('should handle division by zero in hit rate calculation', () => {
            const stats = cache.getCacheStats();
            expect(stats.hitRate).toBe(0); // No operations should result in 0, not NaN
            expect(stats.expiredCount).toBe(0);
            expect(stats.corruptionCount).toBe(0);
        });
    });

    describe('Cache Cleanup', () => {
        test('should remove expired entries during cleanup', () => {
            cache.set('form1', mockMapping);
            cache.set('form2', mockMapping);

            // Manually expire one entry
            const cacheEntry = (cache as any).cache.get('form1') as CachedFieldMapping;
            cacheEntry.timestamp = new Date(Date.now() - 3700000); // Expired

            // Before cleanup
            expect((cache as any).cache.size).toBe(2);

            cache.cleanup();

            // After cleanup
            expect(cache.get('form1')).toBeNull();      // Expired, removed
            expect(cache.get('form2')).toEqual(mockMapping); // Still valid
            expect((cache as any).cache.size).toBe(1);
        });

        test('should perform LRU eviction during cleanup if over capacity', () => {
            const smallCache = new FieldMappingCache({ 
                maxAge: 3600000, 
                maxSize: 2,
                enablePersistence: false 
            });

            // Add more entries than capacity by manipulating internal cache
            smallCache.set('form1', mockMapping);
            smallCache.set('form2', mockMapping);
            smallCache.set('form3', mockMapping); // This should trigger eviction internally

            // Should have automatically maintained max size
            expect(smallCache.getCacheStats().entryCount).toBeLessThanOrEqual(2);
        });
    });

    describe('Concurrent Access Safety', () => {
        test('should handle rapid successive operations safely', () => {
            const operations = [];

            // Simulate concurrent access
            for (let i = 0; i < 100; i++) {
                operations.push(
                    Promise.resolve().then(() => {
                        cache.set(`form${i % 10}`, mockMapping);
                        return cache.get(`form${i % 10}`);
                    })
                );
            }

            return Promise.all(operations).then(results => {
                // Should complete without errors
                expect(results.length).toBe(100);
                // All successful gets should return the mapping
                results.forEach(result => {
                    if (result !== null) {
                        expect(result).toEqual(mockMapping);
                    }
                });
            });
        });

        test('should maintain consistency during cleanup operations', () => {
            // Add entries
            for (let i = 0; i < 10; i++) {
                cache.set(`form${i}`, mockMapping);
            }

            // Concurrent access during cleanup
            const operations = [
                Promise.resolve().then(() => cache.cleanup()),
                Promise.resolve().then(() => cache.get('form5')),
                Promise.resolve().then(() => cache.set('newForm', mockMapping)),
                Promise.resolve().then(() => cache.getCacheStats())
            ];

            return Promise.all(operations).then(() => {
                // Should complete without errors and maintain cache integrity
                const stats = cache.getCacheStats();
                expect(stats.entryCount).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Configuration Options', () => {
        test('should accept custom configuration options', () => {
            const customOptions: CacheOptions = {
                maxAge: 1800000, // 30 minutes
                maxSize: 50,
                enablePersistence: true
            };

            const customCache = new FieldMappingCache(customOptions);
            
            // Should work with custom settings
            customCache.set('test', mockMapping);
            expect(customCache.get('test')).toEqual(mockMapping);
        });

        test('should use default options when none provided', () => {
            const defaultCache = new FieldMappingCache();
            
            // Should work with defaults
            defaultCache.set('test', mockMapping);
            expect(defaultCache.get('test')).toEqual(mockMapping);
            
            // Default expiration should be 1 hour
            expect((defaultCache as any).options.maxAge).toBe(3600000);
            expect((defaultCache as any).options.maxSize).toBe(100);
            expect((defaultCache as any).options.enablePersistence).toBe(false);
        });

        test('should disable caching when maxSize is 0', () => {
            const disabledCache = new FieldMappingCache({ 
                maxAge: 3600000, 
                maxSize: 0,
                enablePersistence: false 
            });

            disabledCache.set('test', mockMapping);
            expect(disabledCache.get('test')).toBeNull();
            expect(disabledCache.getCacheStats().entryCount).toBe(0);
        });
    });

    describe('Edge Cases and Error Handling', () => {
        test('should handle null and undefined form IDs', () => {
            expect(() => cache.get(null as any)).toThrow();
            expect(() => cache.get(undefined as any)).toThrow();
            expect(() => cache.set(null as any, mockMapping)).toThrow();
            expect(() => cache.set(undefined as any, mockMapping)).toThrow();
        });

        test('should handle empty form IDs', () => {
            expect(() => cache.get('')).toThrow();
            expect(() => cache.set('', mockMapping)).toThrow();
        });

        test('should handle excessively long form IDs', () => {
            const longFormId = 'a'.repeat(2000); // Over the 1000 character limit
            expect(() => cache.get(longFormId)).toThrow('Form ID exceeds maximum length');
            expect(() => cache.set(longFormId, mockMapping)).toThrow('Form ID exceeds maximum length');
        });

        test('should handle null mappings', () => {
            expect(() => cache.set('test', null as any)).toThrow();
            expect(() => cache.set('test', undefined as any)).toThrow();
        });

        test('should handle very large mappings', () => {
            // Create a large mapping
            const largeMapping: FormFieldMapping = {};
            for (let i = 0; i < 1000; i++) {
                largeMapping[`field${i}`] = {
                    fieldId: `field${i}`,
                    fieldType: 'text' as DetectedFieldType,
                    confidence: 0.5,
                    label: `Large Field ${i}`
                };
            }

            // Should handle large mappings without error
            expect(() => cache.set('large', largeMapping)).not.toThrow();
            expect(cache.get('large')).toEqual(largeMapping);
        });
    });

    describe('Corruption Detection and Recovery', () => {
        test('should detect and recover from access order corruption', () => {
            const loggingCache = new FieldMappingCache({ 
                maxSize: 3, 
                maxAge: 3600000,
                enablePersistence: false,
                enableLogging: true 
            });

            // Add some entries
            loggingCache.set('form1', mockMapping);
            loggingCache.set('form2', mockMapping);
            
            // Manually corrupt access order by adding duplicate
            (loggingCache as any).accessOrder.push('form1');
            
            // This should detect corruption and rebuild
            loggingCache.set('form3', mockMapping);
            
            const stats = loggingCache.getCacheStats();
            expect(stats.corruptionCount).toBeGreaterThan(0);
            
            // Cache should still function correctly after recovery
            expect(loggingCache.get('form1')).toEqual(mockMapping);
            expect(loggingCache.get('form2')).toEqual(mockMapping);
            expect(loggingCache.get('form3')).toEqual(mockMapping);
        });

        test('should handle expired entries tracking separately', () => {
            const shortCache = new FieldMappingCache({ 
                maxAge: 100, // Very short expiry
                maxSize: 10,
                enablePersistence: false 
            });

            shortCache.set('test', mockMapping);
            
            // Mock expiration
            const entry = (shortCache as any).cache.get('test');
            entry.timestamp = new Date(Date.now() - 200); // Expired

            // Should count as expired, not miss
            expect(shortCache.get('test')).toBeNull();
            
            const stats = shortCache.getCacheStats();
            expect(stats.expiredCount).toBe(1);
            expect(stats.hitRate).toBe(0); // No successful hits
        });

        test('should prevent infinite loops in enforceSizeLimit', () => {
            const smallCache = new FieldMappingCache({ 
                maxSize: 2,
                maxAge: 3600000,
                enablePersistence: false,
                enableLogging: true 
            });

            // Add entries normally
            smallCache.set('form1', mockMapping);
            smallCache.set('form2', mockMapping);

            // Manually corrupt access order to contain non-existent entries
            (smallCache as any).accessOrder = ['nonexistent1', 'form1', 'nonexistent2', 'form2'];

            // This should detect corruption and not infinite loop
            smallCache.set('form3', mockMapping);

            const stats = smallCache.getCacheStats();
            expect(stats.corruptionCount).toBeGreaterThan(0);
            expect(stats.entryCount).toBeLessThanOrEqual(2); // Should respect size limit
        });

        test('should reset all stats including new counters', () => {
            // Create some activity to generate stats
            cache.set('test', mockMapping);
            cache.get('test'); // hit
            cache.get('missing'); // miss

            // Mock expired and corruption counts
            (cache as any).expiredCount = 5;
            (cache as any).corruptionCount = 2;

            let stats = cache.getCacheStats();
            expect(stats.hitRate).toBeGreaterThan(0);
            expect(stats.expiredCount).toBe(5);
            expect(stats.corruptionCount).toBe(2);

            // Reset stats
            cache.resetStats();

            stats = cache.getCacheStats();
            expect(stats.hitRate).toBe(0);
            expect(stats.expiredCount).toBe(0);
            expect(stats.corruptionCount).toBe(0);
        });
    });

    describe('Configurable Logging', () => {
        test('should respect enableLogging option', () => {
            const quietCache = new FieldMappingCache({ 
                maxSize: 10,
                maxAge: 3600000,
                enablePersistence: false,
                enableLogging: false // Disable logging
            });

            expect((quietCache as any).enableLogging).toBe(false);

            const verboseCache = new FieldMappingCache({ 
                maxSize: 10,
                maxAge: 3600000,
                enablePersistence: false,
                enableLogging: true // Enable logging
            });

            expect((verboseCache as any).enableLogging).toBe(true);
        });

        test('should default to logging disabled', () => {
            const defaultCache = new FieldMappingCache();
            expect((defaultCache as any).enableLogging).toBe(false);
        });
    });
});