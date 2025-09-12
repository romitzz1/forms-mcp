// ABOUTME: Performance caching system for field type mappings with LRU eviction and expiration handling
// ABOUTME: Thread-safe operations with cache statistics and configurable options for optimal memory usage

import { FormFieldMapping } from './fieldTypeDetector';

export interface CachedFieldMapping {
    formId: string;
    mapping: FormFieldMapping;
    timestamp: Date;
    lastAccessed: Date;
}

export interface CacheOptions {
    maxAge: number;              // Cache expiration time in milliseconds
    maxSize: number;             // Maximum number of cached form mappings
    enablePersistence: boolean;  // Enable persistent storage (future feature)
}

export interface CacheStats {
    hitRate: number;           // Cache hit rate (0.0 to 1.0)
    entryCount: number;        // Current number of cached entries
    memoryUsage: number;       // Estimated memory usage in bytes
}

export class FieldMappingCache {
    private cache: Map<string, CachedFieldMapping>;
    private options: CacheOptions;
    private accessOrder: string[]; // For LRU tracking
    private hitCount: number = 0;
    private missCount: number = 0;

    // Default configuration
    private static readonly DEFAULT_OPTIONS: CacheOptions = {
        maxAge: 3600000,        // 1 hour in milliseconds
        maxSize: 100,           // 100 form mappings
        enablePersistence: false
    };

    constructor(options?: Partial<CacheOptions>) {
        this.options = { ...FieldMappingCache.DEFAULT_OPTIONS, ...options };
        this.cache = new Map();
        this.accessOrder = [];
    }

    /**
     * Retrieves cached field mapping for a form
     */
    public get(formId: string): FormFieldMapping | null {
        this.validateFormId(formId);

        const entry = this.cache.get(formId);
        
        if (!entry) {
            this.missCount++;
            return null;
        }

        // Check if expired
        if (this.isExpired(entry)) {
            this.cache.delete(formId);
            this.removeFromAccessOrder(formId);
            this.missCount++;
            return null;
        }

        // Update access tracking
        entry.lastAccessed = new Date();
        this.updateAccessOrder(formId);
        this.hitCount++;

        return entry.mapping;
    }

    /**
     * Stores field mapping in cache
     */
    public set(formId: string, mapping: FormFieldMapping): void {
        this.validateFormId(formId);
        this.validateMapping(mapping);

        // If cache is disabled (maxSize 0), don't store anything
        if (this.options.maxSize === 0) {
            return;
        }

        const now = new Date();
        const entry: CachedFieldMapping = {
            formId,
            mapping,
            timestamp: now,
            lastAccessed: now
        };

        // Remove existing entry if it exists
        if (this.cache.has(formId)) {
            this.removeFromAccessOrder(formId);
        }

        // Add new entry
        this.cache.set(formId, entry);
        this.updateAccessOrder(formId);

        // Enforce size limit with LRU eviction
        this.enforceSizeLimit();
    }

    /**
     * Invalidates cache entries
     */
    public invalidate(formId?: string): void {
        if (formId) {
            this.validateFormId(formId);
            this.cache.delete(formId);
            this.removeFromAccessOrder(formId);
        } else {
            // Invalidate all entries
            this.cache.clear();
            this.accessOrder = [];
        }
    }

    /**
     * Checks if a cache entry is expired
     */
    public isExpired(entry: CachedFieldMapping): boolean {
        const now = Date.now();
        const ageMs = now - entry.timestamp.getTime();
        return ageMs > this.options.maxAge;
    }

    /**
     * Gets cache statistics
     */
    public getCacheStats(): CacheStats {
        const totalRequests = this.hitCount + this.missCount;
        const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;

        return {
            hitRate,
            entryCount: this.cache.size,
            memoryUsage: this.estimateMemoryUsage()
        };
    }

    /**
     * Performs cache cleanup - removes expired entries and enforces size limits
     */
    public cleanup(): void {
        // Remove expired entries
        const now = Date.now();
        const expiredKeys: string[] = [];

        for (const [formId, entry] of this.cache.entries()) {
            if (this.isExpired(entry)) {
                expiredKeys.push(formId);
            }
        }

        for (const key of expiredKeys) {
            this.cache.delete(key);
            this.removeFromAccessOrder(key);
        }

        // Enforce size limits
        this.enforceSizeLimit();
    }

    /**
     * Validates form ID parameter
     */
    private validateFormId(formId: string): void {
        if (!formId || typeof formId !== 'string' || formId.trim() === '') {
            throw new Error('Form ID must be a non-empty string');
        }
    }

    /**
     * Validates mapping parameter
     */
    private validateMapping(mapping: FormFieldMapping): void {
        if (!mapping || typeof mapping !== 'object') {
            throw new Error('Mapping must be a valid FormFieldMapping object');
        }
    }

    /**
     * Updates access order for LRU tracking
     */
    private updateAccessOrder(formId: string): void {
        // Remove from current position
        this.removeFromAccessOrder(formId);
        
        // Add to end (most recently used)
        this.accessOrder.push(formId);
    }

    /**
     * Removes form ID from access order tracking
     */
    private removeFromAccessOrder(formId: string): void {
        const index = this.accessOrder.indexOf(formId);
        if (index !== -1) {
            this.accessOrder.splice(index, 1);
        }
    }

    /**
     * Enforces maximum cache size with LRU eviction
     */
    private enforceSizeLimit(): void {
        while (this.cache.size > this.options.maxSize && this.accessOrder.length > 0) {
            // Remove least recently used (first in access order)
            const lruFormId = this.accessOrder[0];
            this.cache.delete(lruFormId);
            this.removeFromAccessOrder(lruFormId);
        }
    }

    /**
     * Estimates memory usage of the cache
     */
    private estimateMemoryUsage(): number {
        let totalBytes = 0;

        for (const [formId, entry] of this.cache.entries()) {
            // Estimate size of form ID (2 bytes per character for UTF-16)
            totalBytes += formId.length * 2;
            
            // Estimate size of mapping object
            totalBytes += this.estimateMappingSize(entry.mapping);
            
            // Estimate overhead for dates and object structure (~200 bytes)
            totalBytes += 200;
        }

        // Add overhead for Map structure and access order array
        totalBytes += this.cache.size * 50; // Map overhead
        totalBytes += this.accessOrder.length * 20; // Array overhead

        return totalBytes;
    }

    /**
     * Estimates size of a field mapping object
     */
    private estimateMappingSize(mapping: FormFieldMapping): number {
        let bytes = 0;
        
        for (const [fieldId, fieldInfo] of Object.entries(mapping)) {
            bytes += fieldId.length * 2;              // Field ID string
            bytes += fieldInfo.fieldId.length * 2;    // Field ID in info
            bytes += fieldInfo.fieldType.length * 2;  // Field type string
            bytes += fieldInfo.label.length * 2;      // Label string
            bytes += 8;                               // Confidence number (64-bit float)
            bytes += 100;                             // Object overhead
        }

        return bytes;
    }

    /**
     * Resets cache statistics
     */
    public resetStats(): void {
        this.hitCount = 0;
        this.missCount = 0;
    }

    /**
     * Gets current cache configuration
     */
    public getOptions(): CacheOptions {
        return { ...this.options };
    }

    /**
     * Updates cache configuration (affects future operations)
     */
    public updateOptions(newOptions: Partial<CacheOptions>): void {
        this.options = { ...this.options, ...newOptions };
        
        // If max size reduced, enforce new limit immediately
        if (newOptions.maxSize !== undefined) {
            this.enforceSizeLimit();
        }
    }
}