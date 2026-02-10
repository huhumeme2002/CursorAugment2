# Requirements Document

## Introduction

This specification transforms the API key system from a "device activation limit" model to a "concurrent usage limit" model. Instead of permanently activating devices, the system will track active sessions and allow a configurable number of concurrent users. This provides more flexibility and better matches real-world usage patterns.

## Glossary

- **Concurrent_Session**: An active API usage session from a specific device/IP combination
- **Session_Timeout**: The duration after which an inactive session is considered expired
- **Max_Concurrent_Users**: The maximum number of simultaneous active sessions allowed per API key
- **Session_ID**: A unique identifier for each active session
- **Admin_Dashboard**: The web interface for managing API keys and settings
- **Redis**: The data store for session and key information

## Requirements

### Requirement 1: Concurrent Session Tracking

**User Story:** As a system, I want to track active sessions instead of permanent device activations, so that users can flexibly use the API across multiple devices without hitting artificial limits.

#### Acceptance Criteria

1. WHEN a request arrives with a valid API key, THE System SHALL create or update a session record
2. WHEN creating a session, THE System SHALL generate a unique session ID based on device ID and timestamp
3. WHEN a session is created, THE System SHALL store the session start time, last activity time, device ID, and IP address
4. WHEN a session receives a new request, THE System SHALL update the last activity time
5. WHEN checking concurrent usage, THE System SHALL count only sessions active within the session timeout period

### Requirement 2: Concurrent Usage Enforcement

**User Story:** As an administrator, I want to limit the number of concurrent users per API key, so that I can control resource usage and prevent abuse.

#### Acceptance Criteria

1. WHEN a request arrives, THE System SHALL count active sessions for that API key
2. WHEN the active session count is below max_concurrent_users, THE System SHALL allow the request
3. WHEN the active session count equals or exceeds max_concurrent_users, THE System SHALL check if the request is from an existing active session
4. IF the request is from an existing active session, THEN THE System SHALL allow the request
5. IF the request is from a new session and limit is reached, THEN THE System SHALL return status 429 with concurrent limit error

### Requirement 3: Session Timeout Management

**User Story:** As a system, I want to automatically expire inactive sessions, so that concurrent slots are freed up for new users.

#### Acceptance Criteria

1. WHEN checking active sessions, THE System SHALL exclude sessions where last_activity is older than session_timeout
2. WHEN a session exceeds the timeout period, THE System SHALL not count it toward concurrent usage
3. THE System SHALL use a default session timeout of 5 minutes
4. WHEN cleaning up sessions, THE System SHALL remove expired session records from Redis
5. THE System SHALL perform session cleanup before counting active sessions

### Requirement 4: Admin Dashboard Configuration

**User Story:** As an administrator, I want to adjust concurrent usage limits through the admin dashboard, so that I can modify limits without recreating keys.

#### Acceptance Criteria

1. WHEN viewing a key in the admin dashboard, THE System SHALL display the current max_concurrent_users value
2. WHEN editing a key, THE Admin_Dashboard SHALL provide an input field for max_concurrent_users
3. WHEN saving key changes, THE System SHALL update the max_concurrent_users value in Redis
4. WHEN updating max_concurrent_users, THE System SHALL validate that the value is a positive integer
5. THE Admin_Dashboard SHALL show current active sessions count for each key

### Requirement 5: Migration from Activation-Based System

**User Story:** As a system administrator, I want to migrate existing keys from activation-based to concurrent-based limits, so that existing users are not disrupted.

#### Acceptance Criteria

1. WHEN loading a key with old schema (max_activations, activations, activated_devices), THE System SHALL auto-migrate to new schema
2. WHEN migrating, THE System SHALL convert max_activations to max_concurrent_users with same value
3. WHEN migrating, THE System SHALL initialize an empty sessions array
4. WHEN migrating, THE System SHALL preserve the expiry date
5. WHEN migration completes, THE System SHALL save the new schema to Redis

### Requirement 6: Session Information Display

**User Story:** As an administrator, I want to see active session details, so that I can monitor usage and troubleshoot issues.

#### Acceptance Criteria

1. WHEN viewing key details, THE Admin_Dashboard SHALL display a list of active sessions
2. FOR each active session, THE System SHALL show device ID, IP address, last activity time, and session duration
3. WHEN displaying sessions, THE System SHALL sort by last activity time (most recent first)
4. THE Admin_Dashboard SHALL show total active sessions vs max_concurrent_users
5. THE Admin_Dashboard SHALL highlight when a key is at or near its concurrent limit

### Requirement 7: Error Messages and Logging

**User Story:** As a developer, I want clear error messages and logging for concurrent usage, so that I can debug issues quickly.

#### Acceptance Criteria

1. WHEN concurrent limit is reached, THE System SHALL return a descriptive error message
2. THE error message SHALL include current active sessions count and max_concurrent_users
3. THE System SHALL log session creation, updates, and cleanup operations
4. WHEN blocking a request, THE System SHALL log the device ID, IP, and reason
5. THE System SHALL log session timeout values and cleanup results

### Requirement 8: Backward Compatibility

**User Story:** As a system, I want to maintain backward compatibility with existing API clients, so that no client code changes are required.

#### Acceptance Criteria

1. THE System SHALL continue to accept the same authentication headers
2. THE System SHALL return the same response formats for successful requests
3. THE System SHALL return the same error status codes (401, 403, 429, 500)
4. WHEN returning 429 errors, THE System SHALL include both old and new format information for compatibility
5. THE proxy endpoint paths and request/response formats SHALL remain unchanged
