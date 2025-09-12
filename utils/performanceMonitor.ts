// ABOUTME: Performance monitoring and metrics collection for universal search system
// ABOUTME: Tracks execution times, API calls, cache performance, and memory usage

type PerformanceStats = Record<string, {
        count: number;
        totalTime: number;
        averageTime: number;
        minTime: number;
        maxTime: number;
    }>;

type CounterStats = Record<string, number>;

interface IMemoryUsage {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
}

interface ITimerHandle {
    operation: string;
    startTime: number;
    startMemory?: IMemoryUsage;
}

export class PerformanceMonitor {
    private stats: PerformanceStats = {};
    private counters: CounterStats = {};
    private enabled: boolean;

    constructor() {
        // Check if performance monitoring is enabled
        this.enabled = process.env.PERFORMANCE_MONITORING_ENABLED !== 'false';
    }

    /**
     * Start timing an operation
     */
    startTimer(operation: string): ITimerHandle {
        if (!this.enabled) {
            return { operation, startTime: 0 };
        }

        return {
            operation,
            startTime: Date.now(),
            startMemory: this.getMemoryUsage()
        };
    }

    /**
     * End timing an operation and record the duration
     */
    endTimer(operation: string, handle: ITimerHandle): number {
        if (!this.enabled || handle.startTime === 0) {
            return 0;
        }

        const duration = Date.now() - handle.startTime;
        this.recordTiming(operation, duration);
        return duration;
    }

    /**
     * Record a timing measurement
     */
    recordTiming(operation: string, duration: number): void {
        if (!this.enabled) return;

        this.stats[operation] ??= {
            count: 0,
            totalTime: 0,
            averageTime: 0,
            minTime: duration,
            maxTime: duration
        };

        const stat = this.stats[operation];
        stat.count++;
        stat.totalTime += duration;
        stat.averageTime = stat.totalTime / stat.count;
        stat.minTime = Math.min(stat.minTime, duration);
        stat.maxTime = Math.max(stat.maxTime, duration);
    }

    /**
     * Increment a counter
     */
    incrementCounter(counter: string, value = 1): void {
        if (!this.enabled) return;

        this.counters[counter] = (this.counters[counter] ?? 0) + value;
    }

    /**
     * Decrement a counter
     */
    decrementCounter(counter: string, value = 1): void {
        if (!this.enabled) return;

        this.counters[counter] = Math.max(0, (this.counters[counter] ?? 0) - value);
    }

    /**
     * Set a counter to a specific value
     */
    setCounter(counter: string, value: number): void {
        if (!this.enabled) return;

        this.counters[counter] = value;
    }

    /**
     * Get all performance statistics
     */
    getStats(): PerformanceStats {
        return { ...this.stats };
    }

    /**
     * Get specific operation statistics
     */
    getOperationStats(operation: string): PerformanceStats[string] | null {
        return this.stats[operation] ?? null;
    }

    /**
     * Get all counter values
     */
    getCounters(): CounterStats {
        return { ...this.counters };
    }

    /**
     * Get specific counter value
     */
    getCounter(counter: string): number {
        return this.counters[counter] ?? 0;
    }

    /**
     * Calculate cache hit rate from counters
     */
    getCacheHitRate(): number {
        const hits = this.getCounter('cache_hits');
        const misses = this.getCounter('cache_misses');
        const total = hits + misses;
        
        return total > 0 ? hits / total : 0;
    }

    /**
     * Get current memory usage
     */
    getMemoryUsage(): IMemoryUsage {
        const usage = process.memoryUsage();
        return {
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            external: usage.external,
            rss: usage.rss
        };
    }

    /**
     * Get performance summary
     */
    getSummary(): {
        operationCount: number;
        totalOperations: number;
        averageResponseTime: number;
        cacheHitRate: number;
        memoryUsage: MemoryUsage;
        topOperations: Array<{ operation: string; averageTime: number; count: number }>;
    } {
        const operationCount = Object.keys(this.stats).length;
        let totalOperations = 0;
        let totalTime = 0;

        // Calculate totals
        Object.values(this.stats).forEach(stat => {
            totalOperations += stat.count;
            totalTime += stat.totalTime;
        });

        const averageResponseTime = totalOperations > 0 ? totalTime / totalOperations : 0;

        // Get top operations by frequency
        const topOperations = Object.entries(this.stats)
            .map(([operation, stat]) => ({
                operation,
                averageTime: stat.averageTime,
                count: stat.count
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return {
            operationCount,
            totalOperations,
            averageResponseTime,
            cacheHitRate: this.getCacheHitRate(),
            memoryUsage: this.getMemoryUsage(),
            topOperations
        };
    }

    /**
     * Reset all statistics
     */
    reset(): void {
        this.stats = {};
        this.counters = {};
    }

    /**
     * Check if monitoring is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Enable performance monitoring
     */
    enable(): void {
        this.enabled = true;
    }

    /**
     * Disable performance monitoring
     */
    disable(): void {
        this.enabled = false;
    }

    /**
     * Measure execution time of a function
     */
    async measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
        const handle = this.startTimer(operation);
        try {
            const result = await fn();
            this.endTimer(operation, handle);
            return result;
        } catch (error) {
            this.endTimer(operation, handle);
            this.incrementCounter(`${operation}_errors`);
            throw error;
        }
    }

    /**
     * Measure execution time of a synchronous function
     */
    measureSync<T>(operation: string, fn: () => T): T {
        const handle = this.startTimer(operation);
        try {
            const result = fn();
            this.endTimer(operation, handle);
            return result;
        } catch (error) {
            this.endTimer(operation, handle);
            this.incrementCounter(`${operation}_errors`);
            throw error;
        }
    }
}