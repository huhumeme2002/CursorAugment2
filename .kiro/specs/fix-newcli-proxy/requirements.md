# Requirements Document

## Introduction

This specification addresses the issue where the Vercel proxy is returning 404 or 200 with no response when forwarding requests from Augment Pro to NewCLI API. The CloudFlare Worker implementation works correctly, but the Vercel migration has URL construction issues that prevent proper communication with the upstream API.

## Glossary

- **Proxy**: The Vercel serverless function that forwards requests from clients to NewCLI API
- **NewCLI**: The upstream AI API service at `https://code.newcli.com/claude/droid`
- **Augment_Pro**: The client application making requests to the proxy
- **CloudFlare_Worker**: The existing working implementation that needs to be replicated
- **Upstream_API**: The NewCLI API that the proxy forwards requests to

## Requirements

### Requirement 1: URL Construction Parity

**User Story:** As a developer, I want the Vercel proxy to construct URLs exactly like the CloudFlare Worker, so that requests reach the correct NewCLI endpoints.

#### Acceptance Criteria

1. WHEN a client requests `/v1/chat/completions`, THE Proxy SHALL forward to `https://code.newcli.com/claude/droid/v1/chat/completions`
2. WHEN the settings contain a custom `api_url`, THE Proxy SHALL append the correct path based on whether the URL already contains `/v1`
3. WHEN the `api_url` ends with `/v1`, THE Proxy SHALL append `/chat/completions` only
4. WHEN the `api_url` does not contain `/v1`, THE Proxy SHALL append `/v1/chat/completions`
5. WHEN the `api_url` has a trailing slash, THE Proxy SHALL remove it before constructing the final URL

### Requirement 2: Request Forwarding

**User Story:** As a developer, I want the proxy to forward all necessary headers and body content, so that the upstream API receives complete request information.

#### Acceptance Criteria

1. WHEN forwarding a request, THE Proxy SHALL include the `Content-Type: application/json` header
2. WHEN forwarding a request, THE Proxy SHALL include the `Authorization: Bearer {api_key}` header with the configured API key
3. WHEN forwarding a request, THE Proxy SHALL send the request body as JSON
4. WHEN the request body contains a model name matching `model_display`, THE Proxy SHALL replace it with `model_actual` before forwarding
5. WHEN the upstream API returns an error, THE Proxy SHALL return the error status and details to the client

### Requirement 3: Streaming Response Handling

**User Story:** As a client, I want to receive streaming responses in real-time, so that I can display AI responses progressively.

#### Acceptance Criteria

1. WHEN the request body contains `stream: true`, THE Proxy SHALL set response headers for Server-Sent Events
2. WHEN streaming, THE Proxy SHALL set `Content-Type: text/event-stream` header
3. WHEN streaming, THE Proxy SHALL set `Cache-Control: no-cache` header
4. WHEN streaming, THE Proxy SHALL set `Connection: keep-alive` header
5. WHEN reading stream chunks, THE Proxy SHALL decode and forward each chunk immediately
6. WHEN a stream chunk contains the actual model name, THE Proxy SHALL replace it with the display model name
7. WHEN the stream completes, THE Proxy SHALL properly close the response
8. IF stream reading fails, THEN THE Proxy SHALL log the error and close the response gracefully

### Requirement 4: Non-Streaming Response Handling

**User Story:** As a client, I want to receive complete JSON responses for non-streaming requests, so that I can process the full response at once.

#### Acceptance Criteria

1. WHEN the request body does not contain `stream: true` or contains `stream: false`, THE Proxy SHALL wait for the complete response
2. WHEN receiving a non-streaming response, THE Proxy SHALL parse it as JSON
3. WHEN the response contains the actual model name, THE Proxy SHALL replace it with the display model name
4. WHEN the response is ready, THE Proxy SHALL return it with status 200 and `Content-Type: application/json`

### Requirement 5: Error Handling and Logging

**User Story:** As a developer, I want detailed error information when requests fail, so that I can debug issues quickly.

#### Acceptance Criteria

1. WHEN the upstream API returns a non-200 status, THE Proxy SHALL capture the error response text
2. WHEN an upstream error occurs, THE Proxy SHALL return the original status code with error details
3. WHEN an internal error occurs, THE Proxy SHALL log the error to console
4. WHEN an internal error occurs, THE Proxy SHALL return status 500 with error message
5. WHEN a stream error occurs, THE Proxy SHALL log the error and close the connection

### Requirement 6: Configuration Validation

**User Story:** As a system administrator, I want the proxy to validate configuration before forwarding requests, so that misconfiguration is caught early.

#### Acceptance Criteria

1. WHEN the API key is not configured in settings or environment, THE Proxy SHALL return status 500 with a descriptive error
2. WHEN settings are loaded from Redis, THE Proxy SHALL use them to override default values
3. WHEN settings are not available in Redis, THE Proxy SHALL use default values from constants and environment variables
4. THE Proxy SHALL use `DEFAULT_API_BASE` as `https://code.newcli.com/claude/droid` when no custom URL is configured

### Requirement 7: Debug Logging

**User Story:** As a developer, I want to see the constructed URL and request details in logs, so that I can verify the proxy is working correctly.

#### Acceptance Criteria

1. WHEN constructing the upstream URL, THE Proxy SHALL log the final URL to console
2. WHEN forwarding a request, THE Proxy SHALL log the request method and headers (excluding sensitive data)
3. WHEN receiving a response, THE Proxy SHALL log the response status code
4. WHEN an error occurs, THE Proxy SHALL log the full error details including stack trace
