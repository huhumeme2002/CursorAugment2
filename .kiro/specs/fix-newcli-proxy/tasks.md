# Implementation Plan: Fix NewCLI Proxy

## Overview

This implementation plan fixes the URL construction and request forwarding issues in the Vercel proxy. The tasks are organized to add debugging capabilities first, then fix the core URL construction logic, and finally add comprehensive tests.

## Tasks

- [x] 1. Add debug logging infrastructure
  - Add console.log statements for URL construction
  - Add console.log statements for request forwarding
  - Add console.log statements for response handling
  - Log all errors with stack traces
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 2. Fix URL construction logic
  - [x] 2.1 Create URL builder function matching CloudFlare Worker logic
    - Extract URL construction into separate function `buildUpstreamUrl()`
    - Implement logic: if base ends with `/v1`, append path without `/v1` prefix
    - Implement logic: if base doesn't contain `/v1`, append full path
    - Remove trailing slashes from base URL before construction
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 2.2 Write property test for URL construction
    - **Property 1: URL Construction Correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

  - [x] 2.3 Update proxy.ts to use new URL builder
    - Replace existing URL construction logic (lines 80-95)
    - Call `buildUpstreamUrl()` with apiBase and client path
    - Add debug logging for constructed URL
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 3. Verify request forwarding
  - [ ] 3.1 Add request logging before fetch
    - Log final URL
    - Log request method
    - Log headers (mask API key for security)
    - Log request body structure (not full content)
    - _Requirements: 7.2_

  - [ ]* 3.2 Write property test for request headers
    - **Property 2: Request Header Completeness**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 3.3 Verify model name transformation in request body
    - Ensure model_display is replaced with model_actual before forwarding
    - Add test case for model transformation
    - _Requirements: 2.4_

- [ ] 4. Checkpoint - Deploy and test with real traffic
  - Deploy to Vercel staging environment
  - Test with Augment Pro client
  - Check Vercel logs for debug output
  - Verify URL construction is correct
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Enhance streaming response handling
  - [ ] 5.1 Add logging for stream lifecycle
    - Log when stream starts
    - Log chunk count and sizes
    - Log when stream completes
    - Log stream errors with details
    - _Requirements: 7.3, 7.4_

  - [ ]* 5.2 Write property test for streaming headers
    - **Property 4: Streaming Headers Completeness**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [ ]* 5.3 Write property test for stream chunk forwarding
    - **Property 5: Stream Chunk Forwarding**
    - **Validates: Requirements 3.5, 3.6, 3.7**

  - [ ] 5.4 Verify stream error handling
    - Ensure errors are logged
    - Ensure response closes gracefully on error
    - _Requirements: 3.8_

- [ ] 6. Enhance non-streaming response handling
  - [ ] 6.1 Add response logging
    - Log upstream status code
    - Log response headers
    - Log response body structure (not full content)
    - _Requirements: 7.3_

  - [ ]* 6.2 Write property test for non-streaming responses
    - **Property 7: Non-Streaming Response Handling**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [ ]* 6.3 Write property test for model name transformation idempotence
    - **Property 3: Model Name Transformation Idempotence**
    - **Validates: Requirements 2.4, 3.6, 4.3**

- [ ] 7. Improve error handling
  - [ ] 7.1 Add comprehensive error logging
    - Log all error types with context
    - Include stack traces for internal errors
    - Mask sensitive data in error logs
    - _Requirements: 5.3, 7.4_

  - [ ]* 7.2 Write property test for error status preservation
    - **Property 6: Error Status Preservation**
    - **Validates: Requirements 2.5, 5.1, 5.2**

  - [ ]* 7.3 Write property test for error handling graceful degradation
    - **Property 9: Error Handling Graceful Degradation**
    - **Validates: Requirements 3.8, 5.3, 5.4, 5.5**

  - [ ] 7.4 Add configuration validation
    - Check for missing API key and return 500 with descriptive error
    - Verify configuration fallback chain works correctly
    - _Requirements: 6.1_

- [ ] 8. Add configuration management tests
  - [ ]* 8.1 Write property test for configuration fallback chain
    - **Property 8: Configuration Fallback Chain**
    - **Validates: Requirements 6.2, 6.3, 6.4**

  - [ ]* 8.2 Write unit test for missing API key error
    - Test that missing API key returns 500
    - Verify error message is descriptive
    - _Requirements: 6.1_

  - [ ]* 8.3 Write unit test for default API base
    - Test that default is used when no custom URL configured
    - Verify default value matches specification
    - _Requirements: 6.4_

- [ ] 9. Final checkpoint - Integration testing
  - Run all tests and ensure they pass
  - Deploy to Vercel production
  - Monitor logs for 24 hours
  - Verify no errors in production
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Debug logging is added first to help diagnose issues before fixing them
- URL construction fix is the critical change that should resolve the 404 errors
