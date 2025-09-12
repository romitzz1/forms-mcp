// ABOUTME: Level 2 caching for search results with LRU eviction and time-based expiration
// ABOUTME: Provides performance optimization for repeated search queries

import type { SearchResult } from './universalSearchManager';

interface ICachedSearchResult {
    formId: string;
    searchText: string;
    results: SearchResult;
    timestamp: Date;
    lastAccessed: Date;
}

interface ISearchResultsCacheOptions {
    maxAge?: number;        // Cache expiry in milliseconds (default: 15 minutes)
    maxSize?: number;       // Maximum cache entries (default: 100)
    enableLogging?: boolean; // Enable debug logging
}

interface ICacheStats {
    hitCount: number;
    missCount: number;
    hitRate: number;
    entryCount: number;
    memoryUsage: number;
    evictionCount: number;
}

export class SearchResultsCache {
    private readonly cache: Map<string, ICachedSearchResult>;
    private accessOrder: string[];
    public readonly options: ISearchResultsCacheOptions;
    private hitCount = 0;
    private missCount = 0;
    private evictionCount = 0;

    constructor(options: ISearchResultsCacheOptions = {}) {
        this.options = {
            maxAge: options.maxAge ?? 15 * 60 * 1000, // 15 minutes default
            maxSize: options.maxSize ?? 100,
            enableLogging: options.enableLogging ?? false
        };
        
        this.cache = new Map();
        this.accessOrder = [];
        
        // Check if caching is disabled via environment
        if (process.env.SEARCH_CACHE_ENABLED === 'false') {
            this.options.maxSize = 0; // Disable caching
        }
    }

    /**
     * Generate cache key from form ID, search text, and optional strategy
     */
    private generateCacheKey(formId: string, searchText: string, strategy?: string): string {
        // Normalize search text for consistent caching
        const normalizedText = searchText.toLowerCase().trim();
        const strategyPart = strategy ? `:${strategy}` : '';
        return `${formId}:${normalizedText}${strategyPart}`;
    }

    /**
     * Check if cache entry has expired
     */
    private isExpired(entry: ICachedSearchResult): boolean {
        const age = Date.now() - entry.timestamp.getTime();
        return age > (this.options.maxAge ?? 15 * 60 * 1000);
    }

    /**
     * Update access order for LRU eviction
     */
    private updateAccessOrder(key: string): void {
        // Remove from current position
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
            this.accessOrder.splice(index, 1);
        }
        
        // Add to end (most recently used)
        this.accessOrder.push(key);
    }

    /**
     * Evict least recently used entries if over size limit
     */
    private evictIfNeeded(): void {
        while (this.cache.size > (this.options.maxSize ?? 100)) {
            const lruKey = this.accessOrder.shift();
            if (lruKey && this.cache.has(lruKey)) {
                this.cache.delete(lruKey);
                this.evictionCount++;
                
                if (this.options.enableLogging) {
                    console.log(`SearchResultsCache: Evicted LRU entry: ${lruKey}`);
                }
            }
        }
    }

    /**
     * Clean up expired entries
     */
    private cleanup(): void {
        const expiredKeys: string[] = [];

        this.cache.forEach((entry, key) => {
            if (this.isExpired(entry)) {
                expiredKeys.push(key);
            }
        });

        expiredKeys.forEach(key => {
            this.cache.delete(key);
            const index = this.accessOrder.indexOf(key);
            if (index > -1) {
                this.accessOrder.splice(index, 1);
            }
        });

        if (this.options.enableLogging && expiredKeys.length > 0) {
            console.log(`SearchResultsCache: Cleaned up ${expiredKeys.length} expired entries`);
        }
    }

    /**
     * Get cached search results
     */
    get(formId: string, searchText: string, strategy?: string): SearchResult | null {
        // If caching disabled, always return null
        if (this.options.maxSize === 0) {
            return null;
        }

        const key = this.generateCacheKey(formId, searchText, strategy);
        const entry = this.cache.get(key);

        if (!entry) {
            this.missCount++;
            return null;
        }

        if (this.isExpired(entry)) {
            this.cache.delete(key);
            const index = this.accessOrder.indexOf(key);
            if (index > -1) {
                this.accessOrder.splice(index, 1);
            }
            this.missCount++;
            return null;
        }

        // Update access time and order
        entry.lastAccessed = new Date();
        this.updateAccessOrder(key);
        this.hitCount++;
        
        if (this.options.enableLogging) {
            console.log(`SearchResultsCache: Hit for ${key}`);
        }

        return entry.results;
    }

    /**
     * Store search results in cache
     */
    set(formId: string, searchText: string, results: SearchResult, strategy?: string): void {
        // If caching disabled, don't store
        if (this.options.maxSize === 0) {
            return;
        }

        const key = this.generateCacheKey(formId, searchText, strategy);
        const now = new Date();

        const entry: ICachedSearchResult = {
            formId,
            searchText,
            results,
            timestamp: now,
            lastAccessed: now
        };

        this.cache.set(key, entry);
        this.updateAccessOrder(key);
        this.evictIfNeeded();

        if (this.options.enableLogging) {
            console.log(`SearchResultsCache: Stored ${key}`);
        }
    }

    /**
     * Invalidate cache entries for a specific form
     */
    invalidateForm(formId: string): void {
        const keysToDelete: string[] = [];

        this.cache.forEach((entry, key) => {
            if (entry.formId === formId) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach(key => {
            this.cache.delete(key);
            const index = this.accessOrder.indexOf(key);
            if (index > -1) {
                this.accessOrder.splice(index, 1);
            }
        });

        if (this.options.enableLogging && keysToDelete.length > 0) {
            console.log(`SearchResultsCache: Invalidated ${keysToDelete.length} entries for form ${formId}`);
        }
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.cache.clear();
        this.accessOrder = [];
        this.hitCount = 0;
        this.missCount = 0;
        this.evictionCount = 0;

        if (this.options.enableLogging) {
            console.log('SearchResultsCache: Cleared all entries');
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): ICacheStats {
        // Clean up expired entries before calculating stats
        this.cleanup();

        const totalRequests = this.hitCount + this.missCount;
        const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;

        // Estimate memory usage (rough calculation)
        let memoryUsage = 0;
        this.cache.forEach(entry => {
            memoryUsage += JSON.stringify(entry).length * 2; // Rough bytes estimate
        });

        return {
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRate,
            entryCount: this.cache.size,
            memoryUsage,
            evictionCount: this.evictionCount
        };
    }

    /**
     * Get current cache size
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Check if cache has specific entry
     */
    has(formId: string, searchText: string, strategy?: string): boolean {
        const key = this.generateCacheKey(formId, searchText, strategy);
        const entry = this.cache.get(key);
        return entry !== undefined && !this.isExpired(entry);
    }
}