
export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// =====================
// RETRY WITH EXPONENTIAL BACKOFF
// =====================

export interface RetryOptions {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
}

/**
 * Retry a function with exponential backoff
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns Result of the function
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxRetries = 3,
        initialDelay = 100,
        maxDelay = 5000,
        backoffFactor = 2
    } = options;

    let lastError: Error | unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt === maxRetries) {
                throw error;
            }

            // Calculate delay with exponential backoff
            const delay = Math.min(
                initialDelay * Math.pow(backoffFactor, attempt),
                maxDelay
            );

            console.log(`[RETRY] Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

// =====================
// CIRCUIT BREAKER
// =====================

export class CircuitBreaker {
    private failures: number = 0;
    private successes: number = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    private nextAttempt: number = 0;
    private openTimeout: number;
    private failureThreshold: number;
    private successThreshold: number;

    constructor(options: {
        failureThreshold?: number;
        successThreshold?: number;
        openTimeout?: number;
    } = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.successThreshold = options.successThreshold || 2;
        this.openTimeout = options.openTimeout || 60000; // 60s default
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() < this.nextAttempt) {
                throw new Error('Circuit breaker is open');
            }
            // Try half-open
            this.state = 'half-open';
            console.log('[CIRCUIT BREAKER] Attempting half-open state');
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;

        if (this.state === 'half-open') {
            this.successes++;
            if (this.successes >= this.successThreshold) {
                this.state = 'closed';
                this.successes = 0;
                console.log('[CIRCUIT BREAKER] Circuit closed - service recovered');
            }
        }
    }

    private onFailure(): void {
        this.failures++;
        this.successes = 0;

        if (this.failures >= this.failureThreshold) {
            this.state = 'open';
            this.nextAttempt = Date.now() + this.openTimeout;
            console.error(`[CIRCUIT BREAKER] Circuit opened after ${this.failures} failures`);
        }
    }

    getState(): string {
        return this.state;
    }

    reset(): void {
        this.failures = 0;
        this.successes = 0;
        this.state = 'closed';
        this.nextAttempt = 0;
    }
}

// =====================
// FETCH WITH RETRY
// =====================

/**
 * Fetch with automatic retry and circuit breaker
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param retryOptions - Retry configuration
 * @returns Fetch response
 */
export async function fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retryOptions: RetryOptions = {}
): Promise<Response> {
    return retryWithBackoff(async () => {
        const response = await fetch(url, options);

        // Only retry on specific status codes
        if (response.status >= 500 || response.status === 429) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
    }, retryOptions);
}
