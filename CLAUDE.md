# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CursorAugment2 is a TypeScript AI API proxy that routes requests to multiple backends (Claude, GPT, Gemini, etc.) with Redis-based key management, rate limiting, and an admin dashboard. It provides an OpenAI-compatible API interface.

**Stateless architecture**: The proxy does NOT store conversation history. Clients must send the full messages array in each request. Redis only stores: API keys, settings, profiles, metrics, and announcements.

**Dual deployment modes**:
- **Vercel Serverless**: Functions auto-generated from `api/` directory (production default)
- **Express Standalone**: Dynamic routing via `server.ts` (local dev, PM2 production)

## Development Commands

```bash
npm install                # Install dependencies
npm run dev:server         # Local Express server (recommended for dev)
npm run dev                # Vercel dev environment (simulates serverless)
npx tsc --noEmit           # TypeScript type checking
npm run deploy             # Deploy to Vercel production (or: vercel --prod)

# API key management
npm run key:create         # Create a new API key
npm run key:list           # List all API keys
npm run key:delete         # Delete an API key

# PM2 production (uses ecosystem.config.js - cluster mode, all CPU cores)
pm2 start ecosystem.config.js
pm2 logs cursor-augment-proxy
```

No linting or formatting tools are configured (no eslint, prettier, or editorconfig).

No automated tests exist. Manual testing only — see Testing section below.

## Architecture

### Request Flow
```
Client → server.ts (Express, dynamic routing) → Authentication → api/proxy.ts → Backend API → Stream response
```

### Dynamic Route System (Express mode only)
`server.ts` maps URL paths to TypeScript files at runtime:
- `/api/admin/keys/list` → `./api/admin/keys/list.ts`
- Each route file exports: `export default async (req, res) => { ... }`
- Security: Directory traversal protection, checks `.ts` then `.js` extensions
- Special case: `/api/proxy` and `/v1/*` routes go directly to `api/proxy.ts`
- `/health` endpoint returns `{ status: 'ok', time: ... }`
- In Vercel mode, file-based routing is handled by the platform automatically

### Two Proxy Implementations
- `api/proxy.ts`: **Primary** — full waterfall fallback, smart usage counting, concurrency tracking, heartbeat streaming
- `api/v1/chat/completions.ts`: **Legacy** — simpler proxy without waterfall/backup profiles, hardcoded model mapping. Not used in Express mode (requests route to proxy.ts instead)

### Authentication
1. **Admin**: JWT-based (24h expiry). Login via `/api/admin/login` with `ADMIN_PASSWORD`. Token in `Authorization: Bearer <token>` header.
2. **User**: API key-based. Header: `Authorization: Bearer <api_key>`. Keys stored in Redis as `api_key:{key_id}`.

## Key Implementation Details

### Proxy Core (`api/proxy.ts`)
- **Model Transformation**: Client sends display name (e.g., "Claude-Opus-4.5-VIP"), proxy maps to `APIProfile.model_actual` for the backend
- **System Prompt Injection**: Injects per-model system prompts from `model_config:{model_name}`. Skipped for `supperapi.store` URLs or when `APIProfile.disable_system_prompt_injection` is true
- **Messages Passthrough**: Forwards the entire messages array unchanged (no filtering/truncation)
- **Conversation Turn-Based Usage Counting** (CRITICAL - Updated 2026-02-13):
  - **Problem**: Claude Code makes 5-10 API calls per user prompt (tool use, parallel calls), causing usage to increment 5-10x
  - **Solution**: Groups requests from same prompt within 60-second window as one conversation turn
  - **Implementation**:
    - Conversation ID = `${clientIP}:${userAgent}:${messageHash}` (client fingerprint + message content)
    - Message hash = first 50 chars + length of last user message
    - Requests within 60s window with same conversation ID = same turn (only first increments usage)
    - **Key insight**: Different prompts have different message content → different conversation IDs → counted separately
    - This solves both problems:
      - ✅ Multiple tool calls for same prompt = 1 usage (same message hash)
      - ✅ New prompt after 30s = new usage (different message hash)
      - ✅ Long prompts (>60s) = still 1 usage (same message hash throughout)
    - Usage incremented AFTER successful response (not before validation)
    - Only counts actual user messages: checks `role: "user"` and content is not `tool_result`
    - Excludes metadata endpoints: `/count_tokens` does NOT increment usage
    - Failed requests (4xx/5xx) do NOT consume quota
  - **Result**: 1 user prompt = 1 usage (regardless of how many tool calls or how long it takes)
  - **Functions**: `checkUsageLimit(keyName)` for pre-validation, `incrementUsage(keyName, conversationId)` after 2xx response
- **Waterfall Fallback**: When primary profile hits concurrency limit, cascades to backup profiles in order. Concurrency tracked via Redis counters `concurrency:{profile_id}`
- **Streaming**: SSE heartbeat every 15s to prevent proxy timeouts. HTTP Keep-Alive connection pooling (50 concurrent, 10 idle connections per host)
- **URL Building** (`buildUpstreamUrl()`): If `api_url` ends with `/v1`, strips `/v1` from client path before appending
- Version tracked via `PROXY_VERSION` constant

### Redis Layer (`lib/redis.ts`)
- **L1 Cache (LRU in-memory)**: Profiles (60s TTL, 100 max), backup profiles (60s), model configs (120s). Reduces Redis calls ~90%
- **L2 Cache (Redis)**: All persistent data via Upstash REST API
- **Schema Auto-Migration**: `getKeyData()` transparently migrates legacy key formats (activation-based, IP-based, concurrent-user-based) to current daily limit schema on first access
- **Settings Cache**: 30s TTL with manual invalidation via `clearSettingsCache()`
- **Cache Invalidation**: Admin save endpoints must call the appropriate cache clear functions after writes
- **Conversation Turn Tracking**:
  - `last_request_timestamp`: Unix timestamp (ms) of last request
  - `last_conversation_id`: Client fingerprint + message hash for grouping requests into conversation turns
  - 60-second window: Requests within this window with same conversation ID are treated as one turn
  - Conversation ID includes message content hash to distinguish different prompts from same client
- **Usage Functions**:
  - `checkUsageLimit(keyName)`: Check quota without incrementing (for pre-validation)
  - `incrementUsage(keyName, conversationId?)`: Increment usage counter (call ONLY after successful response)
    - If `conversationId` provided and matches previous request within 60s, skips increment
    - Conversation ID format: `${clientIP}:${userAgent}:${messageHash}`
    - Returns `{ allowed, currentUsage, limit, shouldIncrement, reason? }`

### Redis Key Schema
```
api_key:{key_id}           → RedisKeyData (quota, expiry, usage)
api_profile:{profile_id}   → APIProfile (backend config)
backup_profile:{profile_id}→ BackupProfile (fallback config with concurrency_limit)
concurrency:{profile_id}   → Number (current concurrent requests)
model_config:{model_name}  → ModelConfig (system prompts, max 10K chars)
settings                   → Global configuration
announcement:{id}          → Announcement
metrics:*                  → Performance metrics
```

### Core Types (`lib/types.ts`)
- `RedisKeyData`: API key with `expiry`, `daily_limit`, `usage_today: { date, count }`, `selected_model`, `selected_api_profile_id`, `last_request_timestamp`, `last_conversation_id`
- `APIProfile`: Backend config with `api_key`, `api_url`, `model_actual`, `capabilities`, `is_active`, `disable_system_prompt_injection`
- `BackupProfile`: Extends APIProfile concept with `concurrency_limit` for waterfall system
- `Announcement`: System notifications with `type` (info/warning/error/success), `priority`, time-based activation
- `ModelConfig`: Per-model configuration with `system_prompt` (max 10K chars), stored as `model_config:{model_name}` in Redis

### Utility Libraries
- `lib/auth.ts`: `generateToken()`, `verifyToken()`, `verifyAdminPassword()`
- `lib/logger.ts`: Winston-based logging with correlation ID tracking. Known issue: uses global `'current'` key in Map — race condition under high concurrency (should use AsyncLocalStorage)
- `lib/metrics.ts`: `MetricsCollector` singleton tracking latency, error rates, throughput with percentile calculations (p50/p95/p99)
- `lib/utils.ts`: `generateUUID()`, `retryWithBackoff()`, `CircuitBreaker` class, `fetchWithRetry()`

## Environment Variables

Required (see `.env.example`):
```bash
API_KEY_GOC=              # Primary backend API key
UPSTASH_REDIS_REST_URL=   # Redis REST URL (Upstash)
UPSTASH_REDIS_REST_TOKEN= # Redis REST token (Upstash)
ADMIN_PASSWORD=           # Admin panel password
JWT_SECRET=               # 32-char hex: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Optional: `PORT` (default 3000), `NODE_ENV`

## Admin Panel Features

### Key Management (`public/admin/`)
The admin panel provides a web UI for managing API keys:
- **Create keys**: Set expiry date and daily usage limit
- **List keys**: View all keys with usage stats and status
- **Delete keys**: Remove keys from Redis
- **Reset quota**: Reset `usage_today` to 0 for a key (POST `/api/admin/keys/reset-quota`)
- **Add quota**: Increase `daily_limit` by specified amount (POST `/api/admin/keys/add-quota`)

### Quota Management Endpoints
Both endpoints accept `name` or `keyName` parameter for compatibility:

**Reset Quota:**
```typescript
POST /api/admin/keys/reset-quota
Body: { name: "key_name" }  // or { keyName: "key_name" }
Response: { success: true, data: { keyName, daily_limit, current_usage: 0, usage_date } }
```

**Add Quota:**
```typescript
POST /api/admin/keys/add-quota
Body: { name: "key_name", amount: 100 }  // or { keyName: "key_name", amount: 100 }
Response: { success: true, data: { keyName, old_daily_limit, new_daily_limit, amount_added, current_usage } }
```

### Adding a New Admin Endpoint

Create `api/admin/{feature}/{action}.ts` — no changes to `server.ts` needed:
```typescript
import { verifyToken } from '../../../lib/auth';

export default async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!verifyToken(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    // Your logic here
};
```

**Important**: When adding endpoints that modify key data, accept both `name` and `keyName` parameters for frontend compatibility.

## Testing

Manual testing only:
1. `npm run dev:server` to start local server
2. Test admin login: `POST /api/admin/login`
3. Create test key: `npm run key:create`
4. Test proxy: `POST /api/v1/chat/completions` with `Authorization: Bearer <key>`
5. Trace requests via `X-Correlation-ID` response header
6. Debug scripts: `debug-key.js` (direct Redis), `debug-key-via-api.js` (via API)

## Troubleshooting

- **403 Forbidden**: See `FIX_403_FORBIDDEN.md`
- **Nginx setup**: See `NGINX_CONFIGURATION.md`
- **Cache issues**: See `SETTINGS_CACHE.md`
- **Usage counting issues**: See `USAGE_COUNTING_FIX.md` for the 2026-02-13 fix that resolved 1 prompt being counted as 5 requests
- **Stuck concurrency counters**: `GET /api/admin/concurrency-status`, then `POST /api/admin/reset-concurrency`. Usually caused by server crashes during streaming
- **"Context memory" complaints**: Not a proxy bug — proxy is stateless and forwards all messages unchanged. Client is likely not sending full history. Debug by logging `requestBody.messages.length` in `api/proxy.ts`
- **TypeScript errors**: Check `tsc_output.txt` and `tsc_output_2.txt` for previous issues. Note: `tsconfig.json` only includes `api/**/*` and `lib/**/*` — `server.ts` is excluded from type checking
- **400 Bad Request on admin endpoints**: If frontend sends `name` but backend expects `keyName` (or vice versa), ensure endpoints accept both parameters for compatibility

## Critical Implementation Rules

When modifying usage counting logic:
1. **NEVER increment usage before validation** - Always validate request first, increment only after successful upstream response
2. **Exclude metadata endpoints** - Endpoints like `/count_tokens`, `/health`, `/status` should never increment usage
3. **Handle failures correctly** - 4xx/5xx responses should NOT consume user quota
4. **Use conversation turn detection** - Pass `conversationId` (format: `${clientIP}:${userAgent}:${messageHash}`) to `incrementUsage()` to group requests within 60s window
5. **Understand the conversation ID** - Includes message content hash to distinguish different prompts from same client, solving both duplicate counting and prompt separation issues
6. **Test with Claude Code** - Verify that 1 user prompt = 1 usage increment, even with multiple tool calls or long execution times
7. **Monitor logs** - Check for `[USAGE] Skipping increment - same conversation turn` messages to verify turn detection works

When adding admin endpoints:
1. **Accept both parameter names** - For key operations, accept both `name` and `keyName` from request body for frontend compatibility
2. **Verify admin token** - Always call `verifyToken()` and check `decoded.admin` before processing
3. **Return consistent responses** - Use `{ success: true, message: "...", data: {...} }` format for success, `{ error: "..." }` for errors
4. **Clear caches when needed** - Call appropriate cache clear functions after modifying profiles, settings, or model configs
