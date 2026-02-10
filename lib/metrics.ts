// =====================
// METRICS COLLECTION SYSTEM
// =====================

interface LatencyHistogram {
    samples: number[];
    maxSamples: number;
}

interface MetricsData {
    requests: {
        total: number;
        success: number;
        errors: number;
        byEndpoint: Record<string, number>;
    };
    latency: {
        samples: number[];
        maxSamples: number;
    };
    cache: {
        hits: number;
        misses: number;
    };
    errors: {
        byType: Record<string, number>;
    };
    startTime: number;
}

class MetricsCollector {
    private data: MetricsData;
    private readonly MAX_LATENCY_SAMPLES = 1000;

    constructor() {
        this.data = {
            requests: {
                total: 0,
                success: 0,
                errors: 0,
                byEndpoint: {},
            },
            latency: {
                samples: [],
                maxSamples: this.MAX_LATENCY_SAMPLES,
            },
            cache: {
                hits: 0,
                misses: 0,
            },
            errors: {
                byType: {},
            },
            startTime: Date.now(),
        };
    }

    /**
     * Record a request
     */
    recordRequest(endpoint: string, success: boolean, latency: number) {
        this.data.requests.total++;
        if (success) {
            this.data.requests.success++;
        } else {
            this.data.requests.errors++;
        }

        // Track by endpoint
        this.data.requests.byEndpoint[endpoint] =
            (this.data.requests.byEndpoint[endpoint] || 0) + 1;

        // Record latency
        this.recordLatency(latency);
    }

    /**
     * Record latency sample
     */
    private recordLatency(ms: number) {
        this.data.latency.samples.push(ms);

        // Keep only last N samples to prevent memory growth
        if (this.data.latency.samples.length > this.MAX_LATENCY_SAMPLES) {
            this.data.latency.samples.shift();
        }
    }

    /**
     * Record cache hit/miss
     */
    recordCacheHit(hit: boolean) {
        if (hit) {
            this.data.cache.hits++;
        } else {
            this.data.cache.misses++;
        }
    }

    /**
     * Record an error
     */
    recordError(errorType: string) {
        this.data.errors.byType[errorType] =
            (this.data.errors.byType[errorType] || 0) + 1;
    }

    /**
     * Calculate percentile from sorted array
     */
    private calculatePercentile(sorted: number[], percentile: number): number {
        if (sorted.length === 0) return 0;
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    /**
     * Get current metrics snapshot
     */
    getMetrics() {
        const uptime = Date.now() - this.data.startTime;
        const sortedLatencies = [...this.data.latency.samples].sort((a, b) => a - b);

        const totalCacheRequests = this.data.cache.hits + this.data.cache.misses;
        const cacheHitRate =
            totalCacheRequests > 0
                ? (this.data.cache.hits / totalCacheRequests) * 100
                : 0;

        const successRate =
            this.data.requests.total > 0
                ? (this.data.requests.success / this.data.requests.total) * 100
                : 100;

        return {
            uptime: {
                ms: uptime,
                seconds: Math.floor(uptime / 1000),
                minutes: Math.floor(uptime / 60000),
            },
            requests: {
                total: this.data.requests.total,
                success: this.data.requests.success,
                errors: this.data.requests.errors,
                successRate: successRate.toFixed(2) + '%',
                byEndpoint: this.data.requests.byEndpoint,
            },
            latency: {
                samples: sortedLatencies.length,
                min: sortedLatencies[0] || 0,
                max: sortedLatencies[sortedLatencies.length - 1] || 0,
                avg:
                    sortedLatencies.length > 0
                        ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
                        : 0,
                p50: this.calculatePercentile(sortedLatencies, 50),
                p95: this.calculatePercentile(sortedLatencies, 95),
                p99: this.calculatePercentile(sortedLatencies, 99),
            },
            cache: {
                hits: this.data.cache.hits,
                misses: this.data.cache.misses,
                hitRate: cacheHitRate.toFixed(2) + '%',
            },
            errors: {
                total: this.data.requests.errors,
                byType: this.data.errors.byType,
            },
        };
    }

    /**
     * Reset all metrics
     */
    reset() {
        this.data = {
            requests: {
                total: 0,
                success: 0,
                errors: 0,
                byEndpoint: {},
            },
            latency: {
                samples: [],
                maxSamples: this.MAX_LATENCY_SAMPLES,
            },
            cache: {
                hits: 0,
                misses: 0,
            },
            errors: {
                byType: {},
            },
            startTime: Date.now(),
        };
    }
}

// Singleton instance
export const metrics = new MetricsCollector();

// Export class for testing
export { MetricsCollector };
