# Implementation Plan: Concurrent Usage Limit

## Overview

This implementation plan transforms the API key system from device activation limits to concurrent usage limits. Tasks are organized to minimize breaking changes and allow for gradual rollout.

## Tasks

- [x] 1. Update Redis schema and types
  - Update RedisKeyData interface to include sessions array
  - Add Session interface with all required fields
  - Add session_timeout_minutes field
  - Keep old fields for backward compatibility during migration
  - _Requirements: 1.3, 5.1_

- [-] 2. Implement session management functions
  - [x] 2.1 Create session generation function
    - Implement generateSessionId(deviceId, keyName)
    - Implement createSession(deviceId, ipAddress)
    - Return Session object with all required fields
    - _Requirements: 1.2, 1.3_

  - [ ] 2.2 Write property test for session ID uniqueness
    - **Property 1: Session ID Uniqueness**
    - **Validates: Requirements 1.2**

  - [x] 2.3 Implement session cleanup function
    - Implement cleanExpiredSessions(sessions, timeoutMs)
    - Filter out sessions where now - last_activity > timeout
    - Return cleaned sessions array
    - _Requirements: 3.1, 3.4_

  - [ ] 2.4 Write property test for session cleanup idempotence
    - **Property 4: Session Cleanup Idempotence**
    - **Validates: Requirements 3.4**

  - [x] 2.5 Implement session finder function
    - Implement findSession(sessions, deviceId)
    - Return existing session or null
    - _Requirements: 2.3, 2.4_

  - [x] 2.6 Implement session update function
    - Implement updateSession(session)
    - Update last_activity to current timestamp
    - _Requirements: 1.4_

  - [ ] 2.7 Write property test for session timestamp monotonicity
    - **Property 6: Session Update Monotonicity**
    - **Validates: Requirements 1.4**

- [ ] 3. Implement concurrent usage checker
  - [ ] 3.1 Create checkConcurrentUsage function
    - Clean expired sessions first
    - Count active sessions
    - Check if device has existing session
    - Check if under concurrent limit
    - Return {allowed, reason, activeCount}
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.2 Write property test for concurrent limit enforcement
    - **Property 2: Concurrent Limit Enforcement**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 3.3 Write property test for existing session preservation
    - **Property 3: Existing Session Preservation**
    - **Validates: Requirements 2.4**

  - [ ] 3.4 Write unit test for under limit scenario
    - Test that requests are allowed when under limit
    - _Requirements: 2.2_

  - [ ] 3.5 Write unit test for at limit with existing session
    - Test that existing sessions bypass limit
    - _Requirements: 2.4_

  - [ ] 3.6 Write unit test for at limit with new session
    - Test that new sessions are blocked at limit
    - _Requirements: 2.5_

- [-] 4. Implement schema migration
  - [x] 4.1 Add migration logic to getKeyData
    - Detect legacy schema (has max_activations field)
    - Convert max_activations to max_concurrent_users
    - Initialize empty sessions array
    - Set default session_timeout_minutes to 5
    - Preserve expiry date
    - Save migrated schema to Redis
    - Log migration
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 4.2 Write property test for migration preservation
    - **Property 5: Migration Preservation**
    - **Validates: Requirements 5.1, 5.2, 5.4**

  - [ ] 4.3 Write unit test for migration with sample legacy key
    - Test that all fields are converted correctly
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [-] 5. Update proxy handler to use concurrent sessions
  - [x] 5.1 Replace device activation logic with session logic
    - Remove isDeviceActivated and activateDevice calls
    - Add session generation and lookup
    - Add concurrent usage check
    - Update session last_activity on each request
    - Save updated sessions to Redis
    - _Requirements: 1.1, 1.4, 2.1_

  - [ ] 5.2 Update error responses for concurrent limit
    - Change 429 error message to mention concurrent sessions
    - Include active_sessions and max_concurrent_users in response
    - Include session_timeout_minutes for user information
    - Keep old fields for backward compatibility
    - _Requirements: 7.1, 7.2, 8.4_

  - [ ] 5.3 Add comprehensive logging
    - Log session creation
    - Log session updates
    - Log cleanup results
    - Log concurrent limit blocks with device ID and IP
    - _Requirements: 7.3, 7.4, 7.5_

  - [ ] 5.4 Write integration test for concurrent flow
    - Test full request flow with session management
    - _Requirements: 1.1, 1.4, 2.1, 2.2_

- [ ] 6. Checkpoint - Test with existing keys
  - Deploy to staging
  - Test with keys that have old schema (should auto-migrate)
  - Test with keys that have new schema
  - Verify sessions are created and cleaned up
  - Verify concurrent limits are enforced
  - Check logs for any errors
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Add admin API endpoints for session management
  - [ ] 7.1 Update keys/list endpoint to include session info
    - Add active_sessions_count to each key
    - Add sessions array to response
    - Calculate and include is_at_limit flag
    - _Requirements: 4.5, 6.1, 6.4_

  - [ ] 7.2 Create endpoint to get key details with sessions
    - Return full key data including sessions array
    - Include session details (device_id, ip_address, last_activity, duration)
    - Sort sessions by last_activity (most recent first)
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 7.3 Update key edit endpoint to support max_concurrent_users
    - Accept max_concurrent_users in request body
    - Validate that value is positive integer
    - Update Redis with new value
    - Return updated key data
    - _Requirements: 4.3, 4.4_

  - [ ] 7.4 Write unit tests for admin endpoints
    - Test list endpoint returns session counts
    - Test detail endpoint returns sorted sessions
    - Test edit endpoint validates input
    - _Requirements: 4.3, 4.4, 4.5, 6.1, 6.2, 6.3_

- [ ] 8. Update admin dashboard UI
  - [ ] 8.1 Update key list table to show concurrent usage
    - Add "Active/Max" column showing "X/Y" format
    - Add visual indicator when at limit (⚠️)
    - Update status column to show concurrent info
    - _Requirements: 4.5, 6.4, 6.5_

  - [ ] 8.2 Update key detail view to show active sessions
    - Add "Active Sessions" section
    - Display table with device ID, IP, last activity, duration
    - Show total active vs max
    - Highlight when at limit
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 8.3 Update key edit form
    - Change "Max Activations" to "Max Concurrent Users"
    - Add tooltip explaining concurrent vs activation
    - Add "Session Timeout (minutes)" field
    - Validate positive integers
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 8.4 Add session timeout configuration
    - Add field to edit session timeout per key
    - Default to 5 minutes
    - Validate reasonable range (1-60 minutes)
    - _Requirements: 3.3_

- [ ] 9. Add backward compatibility tests
  - [ ] 9.1 Write test for authentication header compatibility
    - Test that old auth headers still work
    - _Requirements: 8.1_

  - [ ] 9.2 Write test for response format compatibility
    - Test that successful responses have same format
    - _Requirements: 8.2_

  - [ ] 9.3 Write test for error code compatibility
    - Test that error codes (401, 403, 429, 500) are preserved
    - _Requirements: 8.3_

  - [ ] 9.4 Write test for 429 error format
    - Test that 429 includes both old and new fields
    - _Requirements: 8.4_

  - [ ] 9.5 Write test for endpoint path compatibility
    - Test that /v1/chat/completions and /v1/messages still work
    - _Requirements: 8.5_

- [ ] 10. Final checkpoint - End-to-end testing
  - Create test key with max_concurrent_users = 2
  - Test device 1 can access (session created)
  - Test device 2 can access (session created)
  - Test device 3 is blocked (concurrent limit reached)
  - Wait for session timeout
  - Test device 3 can now access (old sessions expired)
  - Test device 1 can still access (session updated)
  - Verify admin dashboard shows correct session info
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Documentation and deployment
  - Update README with concurrent usage explanation
  - Add migration guide for existing users
  - Document session timeout behavior
  - Document admin dashboard changes
  - Deploy to production
  - Monitor logs for 24 hours
  - _Requirements: All_

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Migration is automatic and backward compatible
- Admin dashboard updates are in separate tasks for flexibility
- Session timeout default is 5 minutes but configurable
