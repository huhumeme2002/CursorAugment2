# Design Document

## Overview

This design addresses the URL construction and request forwarding issues in the Vercel proxy that prevent successful communication with NewCLI API. The core problem is that the current implementation doesn't match the CloudFlare Worker's URL construction logic, resulting in 404 errors or empty responses.

The solution involves:
1. Replicating the CloudFlare Worker's URL construction logic exactly
2. Adding comprehensive debug logging to trace request flow
3. Ensuring proper streaming and non-streaming response handling
4. Validating configuration before making upstream requests

## Architecture

The proxy follows a middleware pattern with these stages:

```
Client Request → CORS Handling → Authentication → Device Activation → 
Configuration Loading → URL Construction → Request Forwarding → 
Response Transformation → Client Response
```

### Key Components

1. **URL Builder**: Constructs upstream API URLs based on configuration
2. **Request Forwarder**: Forwards requests with proper headers and body
3. **Stream Handler**: Manages Server-Sent Events for streaming responses
4. **Response Transformer**: Replaces model names in responses
5. **Error Handler**: Captures and formats errors for debugging

## Components and Interfaces

### URL Construction Module

The URL construction logic must match the CloudFlare Worker exactly:

```typescript
function buildUpstreamUrl(apiBase: string, clientPath: string): string {
    // Remove trailing slash from base
    if (apiBase.endsWith('/')) {
        apiBase = apiBase.slice(0, -1);
    }

    // CloudFlare Worker logic:
    // If base already has /v1, just append the path after /v1
    // Otherwise, append /v1 + path
    
    let finalUrl: string;
    if (apiBase.endsWith('/v1')) {
        // Base is like: https://code.newcli.com/claude/droid/v1
        // Client path is: /v1/chat/completions
        // Remove /v1 from client path and append
        const pathWithoutV1 = clientPath.replace(/^\/v1/, '');
        finalUrl = `${apiBase}${pathWithoutV1}`;
    } else {
        // Base is like: https://code.newcli.com/claude/droid
        // Client path is: /v1/chat/completions
        // Append full path
        finalUrl = `${apiBase}${clientPath}`;
    }

    return finalUrl;
}
```

### Request Forwarding Module

```typescript
interface ForwardRequestOptions {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
}

async function forwardRequest(options: ForwardRequestOptions): Promise<Response> {
    console.log('[PROXY] Forwarding request to:', options.url);
    console.log('[PROXY] Request headers:', JSON.stringify(options.headers, null, 2));
    
    const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: JSON.stringify(options.body),
    });
    
    console.log('[PROXY] Upstream response status:', response.status);
    
    return response;
}
```

### Stream Handler Module

```typescript
async function handleStreamResponse(
    upstreamResponse: Response,
    clientResponse: VercelResponse,
    modelDisplay: string,
    modelActual: string
): Promise<void> {
    // Set SSE headers
    clientResponse.setHeader('Content-Type', 'text/event-stream');
    clientResponse.setHeader('Cache-Control', 'no-cache');
    clientResponse.setHeader('Connection', 'keep-alive');

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
        throw new Error('Failed to get stream reader');
    }

    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                console.log('[PROXY] Stream completed');
                clientResponse.end();
                break;
            }

            // Decode chunk
            let chunk = decoder.decode(value, { stream: true });

            // Transform model names
            chunk = chunk.replace(new RegExp(modelActual, 'g'), modelDisplay);

            // Write to client
            clientResponse.write(chunk);
        }
    } catch (error) {
        console.error('[PROXY] Stream error:', error);
        clientResponse.end();
    }
}
```

### Response Transformer Module

```typescript
function transformResponse(data: any, modelActual: string, modelDisplay: string): any {
    // Convert to JSON string, replace model names, parse back
    const jsonString = JSON.stringify(data);
    const transformed = jsonString.replace(new RegExp(modelActual, 'g'), modelDisplay);
    return JSON.parse(transformed);
}
```

## Data Models

### Configuration

```typescript
interface ProxyConfig {
    apiBase: string;        // e.g., "https://code.newcli.com/claude/droid"
    apiKey: string;         // NewCLI API key
    modelDisplay: string;   // e.g., "Claude-Opus-4.5-VIP"
    modelActual: string;    // e.g., "claude-haiku-4-5-20251001"
}
```

### Request Context

```typescript
interface RequestContext {
    userToken: string;
    deviceId: string;
    requestBody: any;
    config: ProxyConfig;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: URL Construction Correctness

*For any* API base URL (with or without `/v1`, with or without trailing slash) and client path, the constructed upstream URL should follow these rules:
- If base ends with `/v1`, append path without `/v1` prefix
- If base doesn't contain `/v1`, append full path including `/v1`
- Trailing slashes in base URL should be removed before construction
- Result should have no double slashes or missing segments

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

### Property 2: Request Header Completeness

*For any* forwarded request, the upstream request should contain all required headers: `Content-Type: application/json` and `Authorization: Bearer {api_key}` with the configured API key, and the body should be valid JSON.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Model Name Transformation Idempotence

*For any* response (streaming or non-streaming) containing model names, applying the transformation (actual → display) twice should produce the same result as applying it once.

**Validates: Requirements 2.4, 3.6, 4.3**

### Property 4: Streaming Headers Completeness

*For any* streaming request (stream: true), the response should have all required SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive`.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 5: Stream Chunk Forwarding

*For any* stream of chunks from upstream, each chunk should be decoded, transformed (model name replacement), and forwarded immediately to the client, and the stream should close properly when complete.

**Validates: Requirements 3.5, 3.6, 3.7**

### Property 6: Error Status Preservation

*For any* upstream error response (non-200 status), the status code and error details returned to the client should match the upstream response.

**Validates: Requirements 2.5, 5.1, 5.2**

### Property 7: Non-Streaming Response Handling

*For any* non-streaming request (stream: false or absent), the proxy should wait for the complete response, parse it as JSON, transform model names, and return it with status 200 and `Content-Type: application/json`.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 8: Configuration Fallback Chain

*For any* configuration value (api_url, api_key, model_display, model_actual), the system should use the first available value from: Redis settings → environment variables → default constants.

**Validates: Requirements 6.2, 6.3, 6.4**

### Property 9: Error Handling Graceful Degradation

*For any* internal error (stream failure, parsing error, network error), the proxy should log the error details and return an appropriate error response (500 for internal errors) without crashing.

**Validates: Requirements 3.8, 5.3, 5.4, 5.5**

## Error Handling

### Error Categories

1. **Configuration Errors** (500)
   - Missing API key
   - Invalid Redis connection
   - Malformed settings

2. **Authentication Errors** (401, 403)
   - Invalid API key
   - Expired key
   - Device activation limit reached

3. **Upstream Errors** (varies)
   - NewCLI API errors
   - Network failures
   - Timeout errors

4. **Stream Errors** (500)
   - Stream read failures
   - Connection interruptions
   - Encoding errors

### Error Response Format

```typescript
interface ErrorResponse {
    error: string;           // Error category
    message?: string;        // Human-readable message
    details?: string;        // Technical details
    status?: number;         // HTTP status code
}
```

### Logging Strategy

All errors should be logged with:
- Timestamp
- Error type
- Stack trace (for internal errors)
- Request context (excluding sensitive data)

## Testing Strategy

### Unit Tests

1. **URL Construction Tests**
   - Test with base URL ending in `/v1`
   - Test with base URL not containing `/v1`
   - Test with trailing slashes
   - Test with various client paths

2. **Model Name Transformation Tests**
   - Test single occurrence replacement
   - Test multiple occurrence replacement
   - Test nested JSON replacement
   - Test stream chunk replacement

3. **Configuration Loading Tests**
   - Test with Redis settings present
   - Test with only environment variables
   - Test with default constants
   - Test fallback chain

### Property-Based Tests

1. **URL Construction Property Test**
   - Generate random base URLs and paths
   - Verify output matches CloudFlare Worker logic
   - Verify no double slashes or missing segments

2. **Model Transformation Idempotence Test**
   - Generate random JSON responses
   - Apply transformation twice
   - Verify results are identical

3. **Stream Chunk Preservation Test**
   - Generate random stream chunks
   - Process through handler
   - Verify total content matches (after transformation)

### Integration Tests

1. **End-to-End Request Flow**
   - Mock NewCLI API
   - Send request through proxy
   - Verify correct URL construction
   - Verify correct headers
   - Verify response transformation

2. **Streaming Response Test**
   - Mock streaming NewCLI response
   - Verify SSE headers set correctly
   - Verify chunks forwarded in real-time
   - Verify stream closes properly

3. **Error Handling Test**
   - Mock various upstream errors
   - Verify error status preserved
   - Verify error details included
   - Verify proper logging

### Manual Testing Checklist

1. Deploy to Vercel staging
2. Configure with real NewCLI credentials
3. Test with Augment Pro client
4. Verify streaming responses display correctly
5. Check Vercel logs for debug output
6. Test with invalid API key (should fail gracefully)
7. Test with expired key (should return 403)
8. Test with device activation limit (should return 429)

## Implementation Notes

### Critical Changes Required

1. **Fix URL Construction** (api/proxy.ts lines 80-95)
   - Replace current logic with CloudFlare Worker logic
   - Add debug logging for constructed URL

2. **Add Request Logging** (api/proxy.ts line 120)
   - Log final URL before fetch
   - Log request headers (mask API key)

3. **Add Response Logging** (api/proxy.ts line 130)
   - Log upstream status code
   - Log response headers

4. **Verify Stream Handling** (api/proxy.ts lines 140-170)
   - Current implementation looks correct
   - Add logging for stream start/end

### Deployment Strategy

1. Add debug logging first (non-breaking change)
2. Deploy and test with existing logic
3. Fix URL construction
4. Deploy and verify with real traffic
5. Monitor logs for 24 hours
6. Remove excessive debug logging if needed

### Rollback Plan

If the fix causes issues:
1. Revert to previous Vercel deployment
2. Analyze logs to identify root cause
3. Test fix locally with `vercel dev`
4. Redeploy with additional logging
