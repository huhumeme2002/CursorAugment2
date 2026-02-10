# Design Document

## Overview

This design transforms the API key system from tracking permanent device activations to tracking concurrent active sessions. The new system allows multiple devices to use the same API key as long as they don't exceed the concurrent usage limit. Sessions automatically expire after a period of inactivity, freeing up slots for new users.

**Key Benefits:**
- More flexible than permanent device activation
- Automatically handles device changes (new browser, new computer)
- Better matches real-world usage patterns
- Configurable limits through admin dashboard
- Backward compatible with existing clients

## Architecture

### Session-Based Flow

```
Client Request → Authentication → Session Check → Concurrent Limit Check → 
Session Update → Proxy to Upstream → Update Last Activity → Response
```

### Data Flow

1. **Request arrives** with API key
2. **Generate session ID** from device ID + key
3. **Load key data** from Redis (includes sessions array)
4. **Clean expired sessions** (last_activity > timeout)
5. **Check if session exists** in active sessions
6. **If new session**: Check if under concurrent limit
7. **If at limit**: Block request with 429
8. **If under limit**: Create new session
9. **Update session** last_activity timestamp
10. **Proxy request** to upstream API
11. **Return response** to client

## Components and Interfaces

### Session Management Module

```typescript
interface Session {
    session_id: string;          // Unique session identifier
    device_id: string;           // Device identifier (hash of User-Agent)
    ip_address: string;          // Client IP address
    created_at: number;          // Unix timestamp (ms)
    last_activity: number;       // Unix timestamp (ms)
}

interface SessionManager {
    createSession(deviceId: string, ipAddress: string): Session;
    updateSession(sessionId: string): void;
    isSessionActive(session: Session, timeoutMs: number): boolean;
    cleanExpiredSessions(sessions: Session[], timeoutMs: number): Session[];
    findSession(sessions: Session[], deviceId: string): Session | null;
}
```

### Redis Data Schema

**New Schema:**
```typescript
interface RedisKeyData {
    expiry: string;                    // "2026-12-31"
    max_concurrent_users: number;      // e.g., 2
    sessions: Session[];               // Array of active sessions
    session_timeout_minutes: number;   // Default: 5
}
```

**Migration from Old Schema:**
```typescript
interface LegacyRedisKeyData {
    expiry: string;
    max_activations: number;
    activations: number;
    activated_devices: string[];
}

function migrateToNewSchema(legacy: LegacyRedisKeyData): RedisKeyData {
    return {
        expiry: legacy.expiry,
        max_concurrent_users: legacy.max_activations,
        sessions: [],
        session_timeout_minutes: 5
    };
}
```

### Concurrent Usage Checker

```typescript
function checkConcurrentUsage(
    keyData: RedisKeyData,
    deviceId: string,
    ipAddress: string
): { allowed: boolean; reason?: string; activeCount: number } {
    // Clean expired sessions
    const now = Date.now();
    const timeoutMs = keyData.session_timeout_minutes * 60 * 1000;
    const activeSessions = keyData.sessions.filter(s => 
        now - s.last_activity < timeoutMs
    );
    
    // Check if this device already has an active session
    const existingSession = activeSessions.find(s => s.device_id === deviceId);
    if (existingSession) {
        return { allowed: true, activeCount: activeSessions.length };
    }
    
    // Check if under concurrent limit
    if (activeSessions.length < keyData.max_concurrent_users) {
        return { allowed: true, activeCount: activeSessions.length };
    }
    
    // At limit and not an existing session
    return {
        allowed: false,
        reason: 'concurrent_limit_reached',
        activeCount: activeSessions.length
    };
}
```

### Session ID Generation

```typescript
function generateSessionId(deviceId: string, keyName: string): string {
    // Combine device ID + key name for uniqueness
    const combined = `${deviceId}:${keyName}`;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    return hash.substring(0, 24);
}
```

## Data Models

### Session Lifecycle

```
[New Request] → [Create Session] → [Active] → [Inactive after timeout] → [Cleaned up]
                                      ↓
                                [Update on each request]
```

### Session States

1. **Active**: `now - last_activity < timeout`
2. **Expired**: `now - last_activity >= timeout`
3. **Cleaned**: Removed from sessions array

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Session Timeout Correctness

*For any* session with last_activity timestamp, if current time minus last_activity exceeds session_timeout, the session should not be counted as active.

**Validates: Requirements 3.1, 3.2**

### Property 2: Concurrent Limit Enforcement

*For any* API key with max_concurrent_users = N, the number of active sessions should never exceed N, except for existing sessions that were active before the limit was reduced.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Existing Session Preservation

*For any* active session, subsequent requests from the same device ID should be allowed regardless of concurrent limit, as long as the session hasn't expired.

**Validates: Requirements 2.4**

### Property 4: Session Cleanup Idempotence

*For any* sessions array, running cleanup twice should produce the same result as running it once (all expired sessions removed).

**Validates: Requirements 3.4**

### Property 5: Migration Preservation

*For any* legacy key data, migrating to new schema should preserve the expiry date and convert max_activations to max_concurrent_users with the same numeric value.

**Validates: Requirements 5.1, 5.2, 5.4**

### Property 6: Session Update Monotonicity

*For any* session, the last_activity timestamp should never decrease (always moves forward in time).

**Validates: Requirements 1.4**

## Error Handling

### Error Scenarios

1. **Concurrent Limit Reached** (429)
   ```json
   {
     "error": "Concurrent usage limit reached",
     "message": "This key has 2/2 active sessions. Please wait for a session to expire or use an already-active device.",
     "active_sessions": 2,
     "max_concurrent_users": 2,
     "session_timeout_minutes": 5
   }
   ```

2. **Invalid Session Data** (500)
   - Corrupted session records
   - Invalid timestamps
   - Missing required fields

3. **Redis Connection Errors** (500)
   - Cannot load key data
   - Cannot save session updates
   - Timeout errors

### Error Recovery

- **Session corruption**: Remove invalid sessions during cleanup
- **Redis errors**: Log and return 500, don't block all requests
- **Timestamp issues**: Use current time as fallback

## Implementation Strategy

### Phase 1: Add Session Tracking (Non-Breaking)

1. Update Redis schema to include `sessions` array
2. Add session management functions
3. Keep existing activation logic working
4. Log session data for testing

### Phase 2: Switch to Concurrent Logic

1. Replace activation check with concurrent check
2. Update error messages
3. Test with existing keys
4. Monitor logs for issues

### Phase 3: Admin Dashboard Updates

1. Add max_concurrent_users field to key edit form
2. Display active sessions list
3. Show session details (IP, device, last activity)
4. Add session timeout configuration

### Phase 4: Migration and Cleanup

1. Auto-migrate old keys on first access
2. Remove old activation fields after migration
3. Update documentation
4. Remove debug logging

## Admin Dashboard Changes

### Key List View

```
┌─────────────────────────────────────────────────────────────┐
│ Key Name        │ Expiry     │ Active │ Max │ Status       │
├─────────────────────────────────────────────────────────────┤
│ key-abc123      │ 2026-12-31 │ 1/2    │ 2   │ ✅ Active    │
│ key-def456      │ 2026-06-30 │ 2/2    │ 2   │ ⚠️  At Limit │
│ key-ghi789      │ 2025-12-31 │ 0/5    │ 5   │ ❌ Expired   │
└─────────────────────────────────────────────────────────────┘
```

### Key Detail View

```
Key: key-abc123
Expiry: 2026-12-31
Max Concurrent Users: [2] [Edit]
Session Timeout: [5] minutes

Active Sessions (1/2):
┌──────────────────────────────────────────────────────────────┐
│ Device ID        │ IP Address    │ Last Activity │ Duration  │
├──────────────────────────────────────────────────────────────┤
│ a1b2c3d4...      │ 192.168.1.100 │ 2 min ago     │ 15 min    │
└──────────────────────────────────────────────────────────────┘
```

### Edit Key Form

```
Max Concurrent Users: [___2___]
Session Timeout (minutes): [___5___]

[Save Changes] [Cancel]
```

## Testing Strategy

### Unit Tests

1. **Session Creation**
   - Test session ID generation
   - Test session initialization
   - Test timestamp setting

2. **Session Cleanup**
   - Test expired session removal
   - Test active session preservation
   - Test empty sessions array

3. **Concurrent Limit Check**
   - Test under limit (should allow)
   - Test at limit with existing session (should allow)
   - Test at limit with new session (should block)
   - Test over limit (should block)

4. **Migration**
   - Test legacy schema detection
   - Test field conversion
   - Test data preservation

### Integration Tests

1. **End-to-End Flow**
   - Create key with limit 2
   - Make request from device 1 (should succeed)
   - Make request from device 2 (should succeed)
   - Make request from device 3 (should fail with 429)
   - Wait for timeout
   - Make request from device 3 (should succeed)

2. **Session Timeout**
   - Create session
   - Wait for timeout period
   - Verify session is cleaned up
   - Verify new session can be created

3. **Admin Dashboard**
   - Create key
   - Edit max_concurrent_users
   - Verify change is saved
   - Verify active sessions display correctly

### Property-Based Tests

1. **Session Cleanup Idempotence**
   - Generate random sessions arrays
   - Run cleanup twice
   - Verify results are identical

2. **Concurrent Limit Never Exceeded**
   - Generate random request sequences
   - Track active sessions
   - Verify count never exceeds limit (for new sessions)

3. **Session Timestamp Monotonicity**
   - Generate random session updates
   - Verify last_activity always increases

## Performance Considerations

### Redis Operations

- **Session cleanup**: O(n) where n = number of sessions
- **Session lookup**: O(n) linear search through sessions
- **Optimization**: Keep sessions array small by aggressive cleanup

### Cleanup Strategy

- Clean expired sessions on every request (before counting)
- Limit sessions array to reasonable size (e.g., max 100)
- Consider periodic background cleanup job

### Memory Usage

- Each session: ~200 bytes
- 1000 keys × 5 sessions each = ~1MB
- Acceptable for Redis

## Migration Plan

### Automatic Migration

```typescript
async function getKeyData(key: string): Promise<RedisKeyData | null> {
    const data = await redis.get(key);
    if (!data) return null;
    
    // Check if legacy schema
    if ('max_activations' in data && !('max_concurrent_users' in data)) {
        const migrated: RedisKeyData = {
            expiry: data.expiry,
            max_concurrent_users: data.max_activations,
            sessions: [],
            session_timeout_minutes: 5
        };
        await redis.set(key, migrated);
        console.log(`[MIGRATION] Migrated key ${key} to concurrent usage schema`);
        return migrated;
    }
    
    return data as RedisKeyData;
}
```

### Rollback Plan

If issues arise:
1. Revert code to previous version
2. Old schema keys will continue working
3. New schema keys will need manual migration back (or recreation)

## Security Considerations

1. **Session Hijacking**: Device ID based on User-Agent is not cryptographically secure
   - Mitigation: Add IP address validation
   - Future: Add proper session tokens

2. **DoS via Session Creation**: Malicious user could create many sessions
   - Mitigation: Rate limiting on session creation
   - Mitigation: Aggressive session cleanup

3. **Session Enumeration**: Session IDs are predictable
   - Mitigation: Include random component in session ID
   - Current: Hash includes key name (not guessable)

## Deployment Strategy

1. **Deploy with feature flag** (default: off)
2. **Test with internal keys** first
3. **Gradually enable** for production keys
4. **Monitor logs** for issues
5. **Full rollout** after 24h of stable operation
