import winston from 'winston';
import { randomUUID } from 'crypto';

// =====================
// LOGGER CONFIGURATION
// =====================

const isDevelopment = process.env.NODE_ENV !== 'production';

// Create Winston logger instance
export const logger = winston.createLogger({
    level: isDevelopment ? 'debug' : 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        isDevelopment
            ? winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ level, message, timestamp, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
                    return `${timestamp} [${level}]: ${message} ${metaStr}`;
                })
            )
            : winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        // Uncomment to enable file logging in production
        // new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        // new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
});

// =====================
// CORRELATION ID MANAGEMENT
// =====================

/**
 * Generate a unique correlation ID for request tracing
 */
export function generateCorrelationId(): string {
    return randomUUID();
}

/**
 * Storage for current correlation ID (per-request context)
 * In production, use AsyncLocalStorage for proper async context
 */
const correlationIdStorage = new Map<string, string>();

/**
 * Set correlation ID for current context
 */
export function setCorrelationId(id: string): void {
    // Simple implementation - in production use AsyncLocalStorage
    correlationIdStorage.set('current', id);
}

/**
 * Get correlation ID for current context
 */
export function getCorrelationId(): string | undefined {
    return correlationIdStorage.get('current');
}

// =====================
// STRUCTURED LOGGING HELPERS
// =====================

export interface LogContext {
    correlationId?: string;
    userId?: string;
    endpoint?: string;
    method?: string;
    duration?: number;
    statusCode?: number;
    [key: string]: any;
}

/**
 * Log with structured context
 */
export function logInfo(message: string, context?: LogContext) {
    const meta = {
        correlationId: context?.correlationId || getCorrelationId(),
        ...context,
    };
    logger.info(message, meta);
}

export function logError(message: string, error?: Error, context?: LogContext) {
    const meta = {
        correlationId: context?.correlationId || getCorrelationId(),
        error: error?.message,
        stack: error?.stack,
        ...context,
    };
    logger.error(message, meta);
}

export function logWarn(message: string, context?: LogContext) {
    const meta = {
        correlationId: context?.correlationId || getCorrelationId(),
        ...context,
    };
    logger.warn(message, meta);
}

export function logDebug(message: string, context?: LogContext) {
    const meta = {
        correlationId: context?.correlationId || getCorrelationId(),
        ...context,
    };
    logger.debug(message, meta);
}

// =====================
// PERFORMANCE TRACKING
// =====================

/**
 * Create a performance tracker for measuring operation duration
 */
export function createPerformanceTracker(operation: string) {
    const startTime = Date.now();
    const correlationId = getCorrelationId();

    return {
        end: (context?: LogContext) => {
            const duration = Date.now() - startTime;
            logInfo(`${operation} completed`, {
                correlationId,
                duration,
                operation,
                ...context,
            });
            return duration;
        },
        error: (error: Error, context?: LogContext) => {
            const duration = Date.now() - startTime;
            logError(`${operation} failed`, error, {
                correlationId,
                duration,
                operation,
                ...context,
            });
            return duration;
        },
    };
}

// =====================
// REQUEST LOGGER MIDDLEWARE
// =====================

/**
 * Express middleware for request logging with correlation IDs
 */
export function requestLoggerMiddleware(req: any, res: any, next: any) {
    const correlationId = req.headers['x-correlation-id'] || generateCorrelationId();
    req.correlationId = correlationId;
    setCorrelationId(correlationId);

    // Add correlation ID to response headers
    res.setHeader('X-Correlation-ID', correlationId);

    const startTime = Date.now();

    logInfo('Request started', {
        correlationId,
        method: req.method,
        endpoint: req.path,
        ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        userAgent: req.headers['user-agent']?.substring(0, 100),
    });

    // Log response when finished
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        logInfo('Request completed', {
            correlationId,
            method: req.method,
            endpoint: req.path,
            statusCode: res.statusCode,
            duration,
        });
    });

    next();
}
