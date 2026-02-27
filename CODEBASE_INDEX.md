# CursorAugment2 — Codebase Index

**Project**: `vercel-ai-proxy`  
**Version**: 1.0.0  
**Purpose**: Vercel serverless AI proxy with Redis-backed API key management, waterfall load balancing across multiple backend profiles, concurrency tracking, and an admin dashboard.

---

## 📁 Full Directory Structure

```
vercel-ai-proxy/
├── api/
│   ├── proxy.ts                          # Main proxy handler (v3.2.0-monitored)
│   ├── debug-key.ts                      # Debug endpoint for key inspection
│   ├── admin/
│   │   ├── login.ts                      # Admin JWT login
│   │   ├── metrics.ts                    # In-memory metrics snapshot
│   │   ├── concurrency-status.ts         # Live concurrency counters
│   │   ├── reset-concurrency.ts          # Reset concurrency counters
│   │   ├── announcement.ts               # Admin announcement management
│   │   ├── announcement/
│   │   │   ├── get.ts                    # Get all announcements
│   │   │   ├── save.ts                   # Create/update announcement
│   │   │   └── delete.ts                 # Delete announcement
│   │   ├── backup-profiles/
│   │   │   ├── create.ts                 # Create backup profile
│   │   │   ├── list.ts                   # List backup profiles
│   │   │   └── delete.ts                 # Delete backup profile
│   │   ├── cache/
│   │   │   └── clear.ts                  # Manually clear settings cache
│   │   ├── keys/
│   │   │   ├── create.ts                 # Create API key
│   │   │   ├── list.ts                   # List all API keys + usage
│   │   │   ├── delete.ts                 # Delete API key
│   │   │   ├── add-quota.ts              # Add quota to existing key
│   │   │   └── reset-quota.ts            # Reset daily quota for key
│   │   ├── models/
│   │   │   ├── save.ts                   # Save model config (system prompt)
│   │   │   ├── list.ts                   # List model configs
│   │   │   └── delete.ts                 # Delete model config
│   │   ├── profiles/
│   │   │   ├── create.ts                 # Create API profile
│   │   │   ├── list.ts                   # List API profiles
│   │   │   ├── update.ts                 # Update API profile
│   │   │   └── delete.ts                 # Delete API profile
│   │   └── settings/
│   │       ├── get.ts                    # Get global proxy settings
│   │       └── save.ts                   # Save global proxy settings
│   ├── user/
│   │   ├── announcement.ts               # Get active announcements (public)
│   │   ├── model.ts                      # Get/set user's selected model
│   │   ├── profiles.ts                   # List available profiles for user
│   │   ├── select-profile.ts             # Set user's selected API profile
│   │   └── status.ts                     # Check key status + usage
│   └── v1/
│       └── chat/
│           └── completions.ts            # Legacy OpenAI-compatible endpoint
├── lib/
│   ├── types.ts                          # All TypeScript interfaces
│   ├── auth.ts                           # JWT generation + verification
│   ├── redis.ts                          # Redis client + all data operations
│   ├── metrics.ts                        # In-memory MetricsCollector singleton
│   ├── logger.ts                         # Winston logger + correlation IDs
│   └── utils.ts                          # UUID, retry backoff, CircuitBreaker
├── public/
│   ├── index.html                        # Landing page
│   ├── admin/
│   │   ├── index.html                    # Admin dashboard UI
│   │   ├── app.js                        # Admin dashboard logic
│   │   └── metrics.js                    # Real-time metrics display
│   └── user/
│       └── index.html                    # User profile management UI
├── scripts/
│   ├── create-key.js                     # CLI: create API key
│   ├── list-keys.js                      # CLI: list all keys
│   └── delete-key.js                     # CLI: delete a key
├── server.ts                             # Express dev server (dynamic routing)
├── vercel.json                           # Vercel deployment + CORS config
├── package.json                          # Dependencies + npm scripts
├── tsconfig.json                         # TypeScript compiler config
├── ecosystem.config.js                   # PM2 process manager config
└── .gitignore
```

---

## 🏗️ Architecture Overview

```
Client (Cursor / Chatbox / TypingMind / curl)
        │
        │  POST /v1/chat/completions
        │  Authorization: Bearer {user-api-key}
        ▼
┌─────────────────────────────────────────────┐
│              Vercel Serverless              │
│                                             │
│  vercel.json rewrites:                      │
│    /v1/* → /api/proxy                       │
│                                             │
│  api/proxy.ts  (main handler)               │
│    1. Auth: validate user API key           │
│    2. Usage: smart dedup counting           │
│    3. Source selection (waterfall)          │
│    4. Model validation + transform          │
│    5. System prompt injection               │
│    6. Upstream fetch (5min timeout)         │
│    7. Stream/JSON response + rewrite        │
│    8. Concurrency decrement                 │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│           Upstash Redis (REST API)          │
│                                             │
│  Key data, settings, profiles, models,      │
│  concurrency counters, announcements        │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│         Upstream AI Backend(s)              │
│  (Claude / GPT / Gemini / any OpenAI-compat)│
└─────────────────────────────────────────────┘
```

---

## 📄 File-by-File Reference

### `server.ts` — Express Dev Server

Used for **local development** only (`npm run dev:server`). On Vercel, each `api/*.ts` file is a serverless function.

| Feature | Detail |
|---------|--------|
| Port | `process.env.PORT` or `3000` |
| Timeout | 300,000 ms (5 min) for long AI generations |
| Payload limit | 10 MB JSON + text |
| Static files | `public/` served with no-cache for `.js`/`.css` |
| `/admin` route | Serves `public/admin/index.html` |
| `/api/*` | Dynamic router: maps path → `./api/**/*.ts` default export |
| `/v1/*` | Delegates directly to `api/proxy.ts` handler |
| Security | Path traversal check: resolved path must start with `apiDir` |

**Dynamic routing logic:**
```
GET /api/admin/keys/list
  → resolves to ./api/admin/keys/list.ts
  → require(modulePath).default(req, res)
```

---

### `api/proxy.ts` — Main Proxy Handler

The core of the system. Handles all `/v1/*` requests.

**Request flow:**
```
1. Auth
   └─ Extract Bearer token → getKeyData(token)
   └─ Check expiry (isExpired)
   └─ Check daily usage limit

2. Smart Usage Counting
   └─ Only count user messages (skip tool_result content blocks)
   └─ Deferred: increment AFTER successful upstream response
   └─ 60s conversation window dedup (last_conversation_id)

3. Source Selection (Waterfall)
   ├─ Strategy A: User has selected_api_profile_id → use directly (no fallback)
   └─ Strategy B: Waterfall
       ├─ Try default settings (concurrency check)
       ├─ Try each backup profile in order (concurrency check)
       └─ If all full → queue on default (wait + retry)

4. Build Upstream URL
   └─ buildUpstreamUrl(apiBase, clientPath, clientQuery)

5. Model Validation
   └─ req.body.model must match profile's model_display
   └─ Transform to model_actual before forwarding

6. System Prompt Injection
   └─ Formats: auto | anthropic | openai | both |
               user_message | inject_first_user | disabled
   └─ Per-model system prompts from ModelConfig
   └─ Respects profile.disable_system_prompt_injection

7. Upstream Fetch
   └─ 5-minute timeout
   └─ HTTPS keep-alive agent
   └─ Forwards all original headers + Authorization

8. Response Handling
   ├─ Streaming (SSE): heartbeat every 15s, rewriteSSEChunk()
   └─ JSON: rewriteModelName()

9. Cleanup
   └─ decrementConcurrency on finish/error/disconnect
   └─ incrementUsage (deferred, after success)
```

---

### `api/debug-key.ts` — Key Debug Endpoint

`GET /api/debug-key?key={keyName}`

Returns a detailed analysis of a key's state:
- Schema type, expiry, is_expired
- Daily limit, usage date/count, usage percentage
- is_at_limit, available_requests

---

### `api/admin/login.ts`

`POST /api/admin/login`  
Body: `{ password: string }`  
Returns: `{ token: string }` (JWT, 24h expiry)  
Uses `verifyAdminPassword()` → `generateToken({ admin: true })`

---

### `api/admin/metrics.ts`

`GET /api/admin/metrics`  
Protected by JWT. Returns `metrics.getMetrics()` snapshot from `lib/metrics.ts`.

---

### `api/admin/concurrency-status.ts`

`GET /api/admin/concurrency-status`  
Returns current concurrency counts for default + all backup profiles.

---

### `api/admin/reset-concurrency.ts`

`POST /api/admin/reset-concurrency`  
Body: `{ target: 'all' | 'default' | '{backupId}' }`  
Deletes `concurrency:{target}` Redis keys.

---

### `api/admin/cache/clear.ts`

`POST /api/admin/cache/clear`  
Protected by JWT. Calls `clearSettingsCache()` to force Redis re-read on next request.

---

### `api/admin/keys/create.ts`

`POST /api/admin/keys/create`  
Protected by JWT.  
Body: `{ name, expiry (YYYY-MM-DD), daily_limit? (1–10000, default 100) }`  
Validates: expiry format, expiry in future, daily_limit range.  
Calls `createKey(name, expiry, dailyLimit)`.

---

### `api/admin/settings/save.ts`

`POST /api/admin/settings/save`  
Protected by JWT.  
Body: `{ api_url, api_key, model_display?, model_actual?, system_prompt?, concurrency_limit?, system_prompt_format? }`  
Calls `saveSettings(...)` then `clearSettingsCache()`.

---

### `api/admin/backup-profiles/list.ts`

`GET /api/admin/backup-profiles/list`  
Returns `{ profiles: BackupProfile[] }` from `getBackupProfiles()`.

---

### `api/admin/models/list.ts`

`GET /api/admin/models/list`  
Protected by JWT.  
Returns `{ models: [{id, name, system_prompt}], count }` from `getModelConfigs()`.

---

### `api/user/announcement.ts`

`GET /api/user/announcement`  
Public (CORS open). Returns `{ success: true, announcements: Announcement[] }`.  
Non-blocking: returns empty array on error.

---

### `api/user/select-profile.ts`

`POST /api/user/select-profile`  
Auth: Bearer user API key.  
Body: `{ profile_id: string | null }`  
Calls `setKeySelectedProfile(token, profile_id)`.  
`null` resets to default waterfall behavior.

---

### `api/v1/chat/completions.ts`

Legacy OpenAI-compatible endpoint. Delegates to the same proxy logic.

---

## 📚 `/lib` — Shared Library

### `lib/types.ts` — TypeScript Interfaces

| Interface | Purpose |
|-----------|---------|
| `Session` | Concurrent user tracking (session_id, device_id, ip, timestamps, rate limiting) |
| `RedisKeyData` | API key storage schema |
| `APIProfile` | Backend API configuration |
| `BackupProfile` | Extends APIProfile with `concurrency_limit` |
| `ModelConfig` | Per-model system prompt config |
| `LegacyActivationKeyData` | Migration compatibility for old activation-based schema |
| `OpenAIRequest` | Standard chat completion request |
| `OpenAIResponse` | Standard chat completion response |
| `Announcement` | System-wide notification |

**`RedisKeyData` fields:**
```typescript
{
  expiry: string;                    // "YYYY-MM-DD"
  daily_limit: number;               // Max requests/day
  usage_today: { date: string; count: number };
  session_timeout_minutes: number;   // Legacy compat
  selected_model?: string;           // User-chosen model ID
  selected_api_profile_id?: string;  // User-chosen profile ID
  last_request_timestamp?: number;   // For conversation turn detection
  last_conversation_id?: string;     // 60s dedup window
}
```

**`APIProfile` fields:**
```typescript
{
  id: string;                        // UUID
  name: string;                      // Display name
  api_key: string;                   // Backend API key
  api_url: string;                   // Backend endpoint URL
  model_actual?: string;             // Actual model name sent upstream
  model_display?: string;            // Model name shown to clients
  capabilities: string[];            // e.g. ["image", "tools"]
  speed: "fast" | "medium" | "slow";
  is_active: boolean;
  disable_system_prompt_injection?: boolean;
  system_prompt_format?: 'auto' | 'anthropic' | 'openai' | 'both' |
                          'user_message' | 'inject_first_user' | 'disabled';
}
```

---

### `lib/auth.ts` — JWT Authentication

| Function | Signature | Description |
|----------|-----------|-------------|
| `generateToken` | `(payload) → string` | Signs JWT with 24h expiry |
| `verifyToken` | `(token) → any \| null` | Verifies JWT, returns null on failure |
| `verifyAdminPassword` | `(password) → boolean` | Compares against `ADMIN_PASSWORD` env var |

- Secret: `process.env.JWT_SECRET` (fallback: `'your-secret-key-change-this'`)
- Expiry: `24h`

---

### `lib/redis.ts` — Redis Client + Data Operations

Uses `@upstash/redis` REST client. Includes LRU in-memory caching to reduce Redis round-trips.

**Redis Key Naming:**
| Redis Key | Value Type | Description |
|-----------|-----------|-------------|
| `{keyName}` | `RedisKeyData` JSON | User API key data (key name IS the Redis key) |
| `__proxy_settings__` | `ProxySettings` JSON | Global proxy configuration |
| `__api_profiles__` | `Record<string, APIProfile>` JSON | All API profiles |
| `__backup_profiles__` | `BackupProfile[]` JSON | Backup/fallback profiles |
| `__announcements__` | `Announcement[]` JSON | All announcements |
| `__model_configs__` | `Record<string, ModelConfig>` JSON | Per-model system prompts |
| `concurrency:{id}` | number | Live concurrency counter (default or backup ID) |

**Cache TTLs (LRU in-memory):**
| Data | TTL |
|------|-----|
| Settings | 30 seconds |
| API Profiles | 60 seconds |
| Backup Profiles | 60 seconds |
| Model Configs | 120 seconds |

**Key Functions:**

| Function | Returns | Description |
|----------|---------|-------------|
| `getKeyData(key)` | `RedisKeyData \| null` | Fetch key with auto-migration from legacy schema |
| `validateKeyWithUsage(keyName, sourceId, concurrencyLimit?)` | validation result | Batched pipeline validation |
| `incrementUsage(keyName, conversationId?)` | `{allowed, currentUsage, limit, shouldIncrement}` | 60s conversation window dedup |
| `checkUsageLimit(keyName)` | `{allowed, currentUsage, limit}` | Check without incrementing |
| `createKey(keyName, expiry, dailyLimit)` | `{success}` | Create new API key |
| `deleteKey(keyName)` | `boolean` | Delete API key |
| `getAllKeys()` | `string[]` | List all user key names |
| `isExpired(expiryDate)` | `boolean` | Check if date string is past today |
| `getSettings()` | `ProxySettings` | Get global settings (30s cache) |
| `saveSettings(...)` | `boolean` | Save global settings |
| `clearSettingsCache()` | `void` | Invalidate settings memory cache |
| `getAPIProfiles()` | `Record<string, APIProfile>` | All profiles (60s LRU cache) |
| `getAPIProfile(id)` | `APIProfile \| null` | Single profile by ID |
| `saveAPIProfile(profile)` | `boolean` | Create/update profile |
| `deleteAPIProfile(id)` | `boolean` | Delete profile |
| `getBackupProfiles()` | `BackupProfile[]` | All backup profiles (60s LRU cache) |
| `saveBackupProfiles(profiles)` | `boolean` | Save backup profiles array |
| `getModelConfigs()` | `Record<string, ModelConfig>` | All model configs (120s LRU cache) |
| `saveModelConfig(id, config)` | `boolean` | Save model config |
| `deleteModelConfig(id)` | `boolean` | Delete model config |
| `getKeySelectedModel(keyName)` | `string \| null` | Get user's selected model |
| `setKeySelectedModel(keyName, modelId)` | `boolean` | Set user's selected model |
| `setKeySelectedProfile(keyName, profileId)` | `boolean` | Set user's selected profile |
| `incrementConcurrency(id, limit)` | `{allowed, current}` | Atomic increment with limit check |
| `decrementConcurrency(id)` | `void` | Decrement concurrency counter |
| `getConcurrency(id)` | `number` | Get current concurrency count |
| `getAnnouncements()` | `Announcement[]` | All announcements |
| `getActiveAnnouncements()` | `Announcement[]` | Filtered by is_active + time window |
| `saveAnnouncement(a)` | `boolean` | Create/update announcement |
| `deleteAnnouncement(id)` | `boolean` | Delete announcement |

---

### `lib/metrics.ts` — In-Memory Metrics Collector

Singleton `MetricsCollector` instance exported as `metrics`.

**Tracks:**
- `requests`: total, success, errors, by-endpoint counts
- `latency`: rolling window of last 1000 samples (min, max, avg, p50, p95, p99)
- `cache`: hits and misses with hit rate %
- `errors`: by error type
- `uptime`: ms, seconds, minutes since start

**Methods:**
| Method | Description |
|--------|-------------|
| `recordRequest(endpoint, success, latency)` | Record a completed request |
| `recordCacheHit(hit)` | Record cache hit or miss |
| `recordError(errorType)` | Increment error type counter |
| `getMetrics()` | Return full metrics snapshot |
| `reset()` | Reset all counters |

---

### `lib/logger.ts` — Winston Logger

| Export | Type | Description |
|--------|------|-------------|
| `logger` | Winston instance | Main logger (debug in dev, info+json in prod) |
| `generateCorrelationId()` | `() → string` | UUID for request tracing |
| `setCorrelationId(id)` | `(string) → void` | Store correlation ID in map |
| `getCorrelationId()` | `() → string \| undefined` | Retrieve current correlation ID |
| `logInfo(msg, ctx?)` | helper | Structured info log |
| `logError(msg, err?, ctx?)` | helper | Structured error log with stack |
| `logWarn(msg, ctx?)` | helper | Structured warn log |
| `logDebug(msg, ctx?)` | helper | Structured debug log |
| `createPerformanceTracker(op)` | `→ {end, error}` | Measure operation duration |
| `requestLoggerMiddleware` | Express middleware | Logs request start/end with correlation ID |

**Log format:**
- Development: colorized `timestamp [level]: message {meta}`
- Production: JSON with timestamp, level, message, meta

---

### `lib/utils.ts` — General Utilities

| Export | Description |
|--------|-------------|
| `generateUUID()` | RFC4122 v4 UUID (Math.random based) |
| `retryWithBackoff(fn, options?)` | Retry async fn with exponential backoff (default: 3 retries, 100ms initial, 2x factor, 5s max) |
| `CircuitBreaker` | Class: closed/open/half-open states, configurable failure threshold (default 5), success threshold (default 2), open timeout (default 60s) |
| `fetchWithRetry(url, options?, retryOptions?)` | fetch() with automatic retry on 5xx/429 |

---

## 🔑 Authentication Layers

### User Authentication (API Key)
```
Request Header: Authorization: Bearer {api-key-name}
  → getKeyData(api-key-name) from Redis
  → Check expiry (isExpired)
  → Check daily_limit vs usage_today.count
```

### Admin Authentication (JWT)
```
POST /api/admin/login { password }
  → verifyAdminPassword(password) vs ADMIN_PASSWORD env
  → generateToken({ admin: true }) → JWT (24h)
  
Subsequent admin requests:
  Authorization: Bearer {jwt-token}
  → verifyToken(token) → decoded payload or null
```

---

## 🔄 Proxy Source Selection (Waterfall)

```
User has selected_api_profile_id?
  YES → Use that profile directly (no fallback, fail if unavailable)
  NO  → Waterfall:
    1. Try default settings
       └─ incrementConcurrency('default', settings.concurrency_limit)
       └─ If allowed → use default
    2. Try backup profiles (in order)
       └─ For each active backup:
           incrementConcurrency(backup.id, backup.concurrency_limit)
           If allowed → use backup
    3. All full → queue on default (wait loop + retry)
```

---

## 🗄️ Redis Schema (Actual)

### User API Key
```
Redis Key:   {keyName}          (e.g., "user-alice-2025")
Redis Value: {
  "expiry": "2026-12-31",
  "daily_limit": 100,
  "usage_today": { "date": "2025-08-15", "count": 42 },
  "session_timeout_minutes": 30,
  "selected_model": "gemini",
  "selected_api_profile_id": "uuid-of-profile",
  "last_request_timestamp": 1723728000000,
  "last_conversation_id": "conv-uuid"
}
```

### Global Settings
```
Redis Key:   __proxy_settings__
Redis Value: {
  "api_url": "https://api.anthropic.com",
  "api_key": "sk-ant-...",
  "model_display": "Claude-Opus-4.5-VIP",
  "model_actual": "claude-opus-4-5",
  "system_prompt": "You are a helpful assistant.",
  "system_prompt_format": "anthropic",
  "concurrency_limit": 5
}
```

### API Profiles
```
Redis Key:   __api_profiles__
Redis Value: {
  "uuid-1": { id, name, api_key, api_url, model_actual, model_display,
               capabilities, speed, is_active, system_prompt_format, ... },
  "uuid-2": { ... }
}
```

### Backup Profiles
```
Redis Key:   __backup_profiles__
Redis Value: [
  { ...APIProfile fields..., "concurrency_limit": 3 },
  ...
]
```

### Model Configs
```
Redis Key:   __model_configs__
Redis Value: {
  "gemini": { "name": "Gemini 2.0", "system_prompt": "..." },
  "gpt5":   { "name": "GPT-5", "system_prompt": "..." }
}
```

### Concurrency Counters
```
Redis Key:   concurrency:default     → number (current active requests on default)
Redis Key:   concurrency:{backupId}  → number (current active requests on backup)
```

### Announcements
```
Redis Key:   __announcements__
Redis Value: [
  {
    "id": "uuid",
    "title": "Maintenance",
    "content": "<b>System update</b>",
    "type": "warning",
    "priority": 10,
    "is_active": true,
    "start_time": "2025-08-01T00:00:00Z",
    "end_time": "2025-08-02T00:00:00Z",
    "created_at": 1722470400000,
    "updated_at": 1722470400000
  }
]
```

---

## 🌐 API Endpoint Reference

### Public Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health check |
| GET | `/api/user/announcement` | Get active announcements |
| GET | `/api/debug-key?key={name}` | Debug key state |

### User Endpoints (Bearer API Key)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Main AI proxy (OpenAI format) |
| GET | `/api/user/status` | Key status + usage |
| GET | `/api/user/profiles` | Available profiles |
| POST | `/api/user/select-profile` | Set active profile |
| GET/POST | `/api/user/model` | Get/set selected model |

### Admin Endpoints (Bearer JWT)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | Get JWT token |
| GET | `/api/admin/metrics` | Performance metrics |
| GET | `/api/admin/concurrency-status` | Live concurrency |
| POST | `/api/admin/reset-concurrency` | Reset concurrency |
| POST | `/api/admin/cache/clear` | Clear settings cache |
| GET | `/api/admin/keys/list` | List all API keys |
| POST | `/api/admin/keys/create` | Create API key |
| DELETE | `/api/admin/keys/delete` | Delete API key |
| POST | `/api/admin/keys/add-quota` | Add to daily quota |
| POST | `/api/admin/keys/reset-quota` | Reset daily quota |
| GET | `/api/admin/profiles/list` | List API profiles |
| POST | `/api/admin/profiles/create` | Create API profile |
| PUT | `/api/admin/profiles/update` | Update API profile |
| DELETE | `/api/admin/profiles/delete` | Delete API profile |
| GET | `/api/admin/backup-profiles/list` | List backup profiles |
| POST | `/api/admin/backup-profiles/create` | Create backup profile |
| DELETE | `/api/admin/backup-profiles/delete` | Delete backup profile |
| GET | `/api/admin/models/list` | List model configs |
| POST | `/api/admin/models/save` | Save model config |
| DELETE | `/api/admin/models/delete` | Delete model config |
| GET | `/api/admin/settings/get` | Get global settings |
| POST | `/api/admin/settings/save` | Save global settings |
| GET | `/api/admin/announcement/get` | Get all announcements |
| POST | `/api/admin/announcement/save` | Save announcement |
| DELETE | `/api/admin/announcement/delete` | Delete announcement |

---

## ⚙️ Environment Variables

```bash
# Required
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token
ADMIN_PASSWORD=your-admin-password
JWT_SECRET=64-char-hex-string   # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Optional
NODE_ENV=production              # Affects log format (json in prod)
PORT=3000                        # Dev server port (default: 3000)
```

---

## 📦 Dependencies

### Production
| Package | Version | Purpose |
|---------|---------|---------|
| `@upstash/redis` | ^1.28.0 | Redis REST client (Vercel-compatible) |
| `express` | ^4.18.2 | Dev server framework |
| `jsonwebtoken` | ^9.0.2 | JWT generation + verification |
| `lru-cache` | ^10.1.0 | In-memory LRU cache for Redis data |
| `winston` | ^3.11.0 | Structured logging |
| `cors` | ^2.8.5 | CORS middleware |
| `dotenv` | ^16.4.0 | Environment variable loading |

### Development
| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.3.0 | TypeScript compiler |
| `tsx` | ^4.21.0 | TypeScript execution (dev server) |
| `ts-node` | ^10.9.2 | TypeScript Node.js runner |
| `vercel` | ^33.0.0 | Vercel CLI |
| `@vercel/node` | ^3.0.0 | Vercel Node.js types |
| `@types/*` | various | TypeScript type definitions |

---

## 🚀 NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `vercel dev` | Run with Vercel dev environment |
| `npm run dev:server` | `tsx server.ts` | Run Express dev server directly |
| `npm run build` | `tsc` | Compile TypeScript |
| `npm start` | `node dist/server.js` | Run compiled server |
| `npm run deploy` | `vercel --prod` | Deploy to Vercel production |
| `npm run key:create` | `node -r dotenv/config scripts/create-key.js` | CLI: create API key |
| `npm run key:list` | `node -r dotenv/config scripts/list-keys.js` | CLI: list all keys |
| `npm run key:delete` | `node -r dotenv/config scripts/delete-key.js` | CLI: delete a key |

---

## 🔗 Key File Dependencies

```
server.ts
├── api/proxy.ts              (imported directly as handler)
├── api/**/*.ts               (dynamically loaded via require)
└── public/                   (static files)

api/proxy.ts
├── lib/redis.ts              (getKeyData, validateKeyWithUsage, incrementUsage,
│                              getSettings, getAPIProfiles, getBackupProfiles,
│                              getModelConfigs, incrementConcurrency,
│                              decrementConcurrency, isExpired)
└── lib/types.ts              (RedisKeyData, APIProfile, BackupProfile, ModelConfig)

api/admin/*.ts  (all admin endpoints)
├── lib/auth.ts               (verifyToken)
└── lib/redis.ts              (various data operations)

api/user/*.ts   (all user endpoints)
└── lib/redis.ts              (getKeyData, isExpired, setKeySelectedProfile, etc.)

lib/redis.ts
├── @upstash/redis            (Redis REST client)
├── lru-cache                 (LRU in-memory cache)
└── lib/types.ts              (all interfaces)

lib/auth.ts
└── jsonwebtoken              (JWT sign/verify)

lib/logger.ts
└── winston                   (structured logging)

lib/utils.ts
└── (no external deps beyond Node.js built-ins)

lib/metrics.ts
└── (no external deps — pure in-memory)
```

---

## 🎯 Feature Implementation Map

| Feature | Primary Files |
|---------|--------------|
| AI Proxy / Request Forwarding | `api/proxy.ts` |
| OpenAI-Compatible Endpoint | `api/v1/chat/completions.ts` |
| User API Key Auth | `lib/redis.ts` → `getKeyData`, `isExpired` |
| Admin JWT Auth | `lib/auth.ts`, `api/admin/login.ts` |
| Daily Rate Limiting | `lib/redis.ts` → `incrementUsage`, `checkUsageLimit` |
| Concurrency Tracking | `lib/redis.ts` → `incrementConcurrency`, `decrementConcurrency` |
| Waterfall Load Balancing | `api/proxy.ts` (source selection logic) |
| Model Name Transform | `api/proxy.ts` → `rewriteModelName`, `rewriteSSEChunk` |
| System Prompt Injection | `api/proxy.ts` (6 injection formats) |
| SSE Streaming | `api/proxy.ts` (heartbeat + chunk rewrite) |
| Key Management (CRUD) | `api/admin/keys/`, `lib/redis.ts` |
| Profile Management (CRUD) | `api/admin/profiles/`, `lib/redis.ts` |
| Backup Profile Management | `api/admin/backup-profiles/`, `lib/redis.ts` |
| Model Config Management | `api/admin/models/`, `lib/redis.ts` |
| Global Settings | `api/admin/settings/`, `lib/redis.ts` |
| Announcements | `api/admin/announcement/`, `api/user/announcement.ts` |
| In-Memory Metrics | `lib/metrics.ts`, `api/admin/metrics.ts` |
| Structured Logging | `lib/logger.ts` (Winston + correlation IDs) |
| Retry / Circuit Breaker | `lib/utils.ts` |
| Admin Dashboard UI | `public/admin/index.html`, `public/admin/app.js` |
| User Profile UI | `public/user/index.html` |
| CLI Key Management | `scripts/create-key.js`, `scripts/list-keys.js`, `scripts/delete-key.js` |

---

## 🚀 Deployment

**Platform**: Vercel (serverless functions)  
**Runtime**: Node.js  
**Database**: Upstash Redis (REST API — no persistent TCP connection needed)  
**CORS**: Configured in `vercel.json` for all `/v1/*` routes  
**Rewrites**: `/v1/*` → `/api/proxy` (via `vercel.json`)

**Vercel routing (`vercel.json`):**
```json
{
  "rewrites": [
    { "source": "/v1/chat/completions", "destination": "/api/proxy" },
    { "source": "/v1/(.*)",             "destination": "/api/proxy" }
  ]
}
```

---

## 📝 Common Development Tasks

### Add a New Admin Endpoint
1. Create `api/admin/{feature}/{action}.ts`
2. Add JWT verification: `verifyToken(req.headers.authorization...)`
3. Export `default async function handler(req, res)`
4. Server auto-routes via dynamic handler (no registration needed)

### Add a New Backend Profile Type
1. Update `APIProfile` in `lib/types.ts` if new fields needed
2. Add handler in `api/admin/profiles/`
3. Update proxy source selection in `api/proxy.ts` if routing logic changes

### Modify API Key Schema
1. Update `RedisKeyData` in `lib/types.ts`
2. Update `getKeyData()` migration logic in `lib/redis.ts`
3. Update all endpoints that read/write key data
4. Ensure backward compatibility with `LegacyActivationKeyData` migration

### Add a New System Prompt Format
1. Add new format string to `APIProfile.system_prompt_format` union type in `lib/types.ts`
2. Implement injection logic in `api/proxy.ts` system prompt section

---

**Last Updated**: Fully indexed from source — all files read and verified  
**Status**: Active development, modular serverless architecture
