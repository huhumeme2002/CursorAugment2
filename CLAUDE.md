# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**CursorAugment2** is a TypeScript-based AI API proxy that routes requests to multiple backends (Claude, GPT, Gemini, etc.) with Redis-based key management, rate limiting, and an admin dashboard. It provides an OpenAI-compatible API interface while managing multiple API profiles, user sessions, and per-key quotas.

**IMPORTANT: Stateless Architecture**
- The proxy is **completely stateless** - it does NOT store conversation history
- Clients must send the full messages array in each request (standard OpenAI-compatible behavior)
- Redis only stores: API keys, settings, profiles, metrics, and announcements
- No conversation state, chat history, or message storage exists in the proxy

**Dual Deployment Modes:**
- **Vercel Serverless**: Serverless functions auto-generated from `api/` directory (production default)
- **Express Standalone**: Full Express server with dynamic routing via `server.ts` (local dev, PM2 production)

## Development Commands

### Local Development
```bash
# Install dependencies
npm install

# Run local development server (Express) - recommended for local dev
npm run dev:server

# Run with Vercel dev environment (simulates serverless)
npm run dev

# TypeScript type checking
npx tsc --noEmit

# Test proxy endpoint locally
curl -X POST http://localhost:3000/api/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"Claude-Opus-4.5-VIP","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

### API Key Management (CLI)
```bash
# Create a new API key
npm run key:create

# List all API keys
npm run key:list

# Delete an API key
npm run key:delete
```

### Deployment
```bash
# Deploy to Vercel production
npm run deploy
# or
vercel --prod
```

### Production (PM2)
```bash
# Start with PM2 (uses ecosystem.config.js)
pm2 start ecosystem.config.js

# Monitor
pm2 monit

# Logs
pm2 logs cursor-augment-proxy

# Restart
pm2 restart cursor-augment-proxy

# Stop
pm2 stop cursor-augment-proxy
```

**PM2 Configuration** (`ecosystem.config.js`):
- Cluster mode with `instances: "max"` (uses all CPU cores)
- Auto-restart on crashes
- 1GB memory limit per instance
- TypeScript execution via `ts-node/register`

## Architecture

### Request Flow
```
Client Request
    ↓
server.ts (Express app with dynamic routing)
    ↓
/api/* routes → Dynamically loaded from ./api/**/*.ts
    ↓
Authentication (JWT for admin, API key for users)
    ↓
api/proxy.ts (Transform request & route to backend)
    ↓
Backend API (Claude, GPT, Gemini, etc.)
    ↓
Stream response back to client
```

### Dynamic Route System
The server uses a dynamic routing system in `server.ts` (Express mode only) that maps URL paths to TypeScript files:
- `/api/admin/keys/list` → `./api/admin/keys/list.ts`
- `/api/v1/chat/completions` → `./api/v1/chat/completions.ts`
- Each route file must export a default async function: `export default async (req, res) => { ... }`
- In Vercel mode, routes are automatically mapped by the platform's file-based routing
- Security: Directory traversal protection prevents accessing files outside `api/` directory
- File resolution: Checks for exact match, then `.ts`, then `.js` extension

### Authentication Layers
1. **Admin Authentication**: JWT-based (24h expiry)
   - Login via `/api/admin/login` with `ADMIN_PASSWORD`
   - Token stored in localStorage, sent in `Authorization: Bearer <token>` header

2. **User Authentication**: API key-based
   - Header: `Authorization: Bearer <api_key>`
   - Keys stored in Redis with schema: `api_key:{key_id}`
   - Validates expiry, daily limits, and session tracking

### Core Data Models (lib/types.ts)

**RedisKeyData**: API key storage schema
- `expiry`: Expiration date (YYYY-MM-DD)
- `daily_limit`: Max requests per day
- `usage_today`: { date, count }
- `session_timeout_minutes`: Session expiry time
- `selected_model`: Current model name
- `selected_api_profile_id`: Active backend profile

**APIProfile**: Backend API configuration
- `id`, `name`: Profile identification
- `api_key`, `api_url`: Backend credentials
- `model_actual`: Real model name for backend
- `capabilities`: Supported features
- `speed`: Performance tier
- `is_active`: Enable/disable flag

**BackupProfile**: Fallback configuration for waterfall system
- Extends `APIProfile` with `concurrency_limit` field
- Used when primary profile reaches max concurrent requests
- Profiles are tried in order until one accepts the request

**Session**: Concurrent user tracking
- `session_id`, `device_id`: Session identification
- `ip_address`: Client IP
- `created_at`, `last_activity`: Timestamps
- `request_count`: Total requests in session
- `rate_window_start`: Rate limiting window

**Announcement**: System-wide notifications
- `id`, `title`, `content`: Announcement details
- `type`: Visual style (info/warning/error/success)
- `priority`: Display order (higher = shown first)
- `is_active`: Enable/disable flag
- `start_time`, `end_time`: Optional time-based activation

### Redis Schema
```
Keys:
- api_key:{key_id} → RedisKeyData
- session:{session_id} → Session (interface defined but not actively used)
- model_config:{model_name} → ModelConfig
- settings → Global configuration
- api_profile:{profile_id} → APIProfile
- backup_profile:{profile_id} → BackupProfile
- concurrency:{profile_id} → Number (current concurrent requests)
- announcement:{announcement_id} → Announcement
- metrics:* → Performance metrics (aggregated periodically)

NOT stored (stateless design):
- conversation:* - No conversation history
- chat_history:* - No message storage
- messages:* - No chat state
- thread:* - No thread tracking
```

**Schema Auto-Migration**: The `getKeyData()` function in `lib/redis.ts` automatically migrates legacy key formats (activation-based, IP-based, concurrent-user-based) to the current daily limit schema. Migration happens transparently on first access.

## Key Files

### Entry Points
- `server.ts`: Express server with dynamic API routing, 5-minute timeout for long AI generations (standalone mode)
- `api/proxy.ts`: Main proxy handler that forwards requests to backend APIs (used by both modes)
- `vercel.json`: Vercel configuration for URL rewrites and CORS headers (serverless mode)

### Core Libraries (lib/)
- `auth.ts`: JWT generation/verification, admin password validation
- `redis.ts`: Redis connection with LRU cache layer (Upstash REST API)
  - Multi-layer caching: L1 (memory LRU) → L2 (Redis)
  - Reduces Redis calls by ~90% for frequently accessed data
  - Auto-migrates legacy key schemas to current format
- `types.ts`: TypeScript interfaces for all data models
- `logger.ts`: Logging utility with correlation ID tracking for request tracing
  - Correlation IDs propagate through entire request lifecycle
  - Enables distributed tracing across proxy → backend → response
- `metrics.ts`: Performance tracking and aggregation
  - Tracks request latency, error rates, and throughput
  - In-memory aggregation with periodic Redis persistence
- `utils.ts`: General utility functions

### API Endpoints (api/)
All endpoints are dynamically loaded by `server.ts`. Key endpoints:

**Admin Panel** (JWT-protected):
- `/api/admin/login`: Admin authentication
- `/api/admin/keys/*`: API key CRUD operations
- `/api/admin/profiles/*`: Backend profile management
- `/api/admin/backup-profiles/*`: Fallback profile management
- `/api/admin/models/*`: Model configuration (system prompts)
- `/api/admin/settings/*`: Global settings
- `/api/admin/metrics`: Usage statistics
- `/api/admin/cache/clear`: Clear Redis cache
- `/api/admin/concurrency-status`: View current concurrency per profile
- `/api/admin/reset-concurrency`: Reset concurrency counters
- `/api/admin/announcement/*`: System-wide announcements (get/save/delete)

**User Endpoints** (API key-protected):
- `/api/user/status`: Check quota and limits
- `/api/user/profiles`: List available backend profiles
- `/api/user/select-profile`: Switch backend profile
- `/api/user/model`: Get/set current model
- `/api/user/announcement`: Get active system announcements

**AI Proxy**:
- `/api/v1/chat/completions`: OpenAI-compatible chat endpoint (main proxy)
- `/api/proxy`: Direct proxy endpoint

### Frontend
- `public/admin/index.html`: Admin dashboard UI
- `public/admin/app.js`: Dashboard logic
- `public/user/index.html`: User profile management

## Environment Variables

Required variables (see `.env.example`):
```bash
API_KEY_GOC=              # Primary backend API key (NewCLI or other AI API key)
UPSTASH_REDIS_REST_URL=   # Redis REST URL (from Upstash dashboard)
UPSTASH_REDIS_REST_TOKEN= # Redis REST token (from Upstash dashboard)
ADMIN_PASSWORD=           # Admin panel password (choose a strong password)
JWT_SECRET=               # 32-char hex for JWT signing (generate using command below)
```

Generate JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Optional variables:
```bash
PORT=3000                 # Server port (default: 3000)
NODE_ENV=production       # Environment mode
```

## Important Implementation Details

### Dynamic Route Loading
- Routes are loaded at runtime using `require()` in `server.ts` (Express mode)
- Security check prevents directory traversal attacks
- Supports both `.ts` and `.js` files
- Returns 404 if route file doesn't exist or has no default export
- In Vercel mode, routes are statically analyzed at build time
- Special case: `/api/proxy` is handled directly by importing `api/proxy.ts`

### Streaming Support
- Native Node.js streaming for AI responses
- 5-minute server timeout to handle long generations (Express mode)
- 10MB payload limit for requests/responses
- **Heartbeat mechanism**: Sends SSE comments every 15 seconds during streaming to prevent nginx/proxy timeouts during long AI thinking periods
- HTTP Keep-Alive connection pooling in `api/proxy.ts` reduces SSL handshake overhead (~100ms → ~0ms)
  - Reuses TCP connections via `httpsAgent` with `keepAlive: true`
  - Maintains up to 50 concurrent connections per host
  - Keeps 10 idle connections ready for instant reuse
- Stream cleanup: Concurrency counters are decremented when stream completes, errors, or client disconnects

### Rate Limiting & Concurrency Management
- Per-day quotas stored in `RedisKeyData.usage_today`
- Session-based concurrent user tracking with automatic cleanup
- **Smart Usage Counting**: Only counts actual user messages, not tool results or assistant messages
  - Checks if last message has `role: "user"` and content is not a `tool_result`
  - Prevents double-counting during multi-turn tool use conversations
- **Waterfall Fallback System**: When primary profile hits concurrency limit, automatically cascades to backup profiles
  - Backup profiles defined in `backup_profile:{id}` with `concurrency_limit` field
  - Concurrency tracked via Redis counters: `concurrency:{profile_id}`
  - Incremented on request start, decremented on completion/error/disconnect
  - Admin endpoints: `/api/admin/concurrency-status`, `/api/admin/reset-concurrency`
- **User Profile Selection**: Users can select a specific API profile, which bypasses waterfall logic

### Model Transformation
- Client sends model name (e.g., "Claude-Opus-4.5-VIP")
- Proxy transforms to actual backend model name via `APIProfile.model_actual`
- Supports custom system prompts per model via `model_config:{model_name}` (max 10K characters)
- **System Prompt Bypass**: Automatically skips system prompt injection for `supperapi.store` URLs or when `APIProfile.disable_system_prompt_injection` is true, to prevent conflicts with backend-managed prompts
- **Messages Array Passthrough**: The proxy forwards the entire messages array unchanged from client to backend (no filtering, truncation, or modification except system prompt injection)
- Proxy version is tracked in `api/proxy.ts` via `PROXY_VERSION` constant for deployment verification

### URL Building Logic
The proxy uses `buildUpstreamUrl()` in `api/proxy.ts` to construct backend URLs:
- If `api_url` ends with `/v1`, strips `/v1` from client path before appending
- Otherwise, appends full client path to base URL
- Matches CloudFlare Worker URL transformation logic
- Example: `https://code.newcli.com/claude/droid/v1` + `/v1/chat/completions` → `https://code.newcli.com/claude/droid/v1/chat/completions`

### Vercel Deployment
- `vercel.json` configures URL rewrites for `/v1/*` routes
- CORS headers configured for cross-origin requests
- Serverless functions auto-generated from `api/` directory structure

### Caching Strategy
**Three-tier caching architecture**:
1. **L1 Cache (LRU in-memory)**: API profiles, backup profiles, model configs
   - 60-120s TTL depending on data type
   - Reduces Redis calls by ~90%
   - Automatically invalidated on admin updates
2. **L2 Cache (Redis)**: All persistent data
   - API keys, sessions, settings, profiles
   - Upstash Redis with REST API
3. **Connection Pool Cache**: HTTPS Keep-Alive connections
   - Reuses TCP/SSL connections to backend APIs
   - Reduces latency from ~100ms to ~0ms per request

## Common Development Patterns

### Adding a New Admin Endpoint
1. Create file: `api/admin/{feature}/{action}.ts`
2. Implement handler with JWT validation:
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
3. Server automatically routes `/api/admin/{feature}/{action}` to your file
4. No need to modify `server.ts` - dynamic routing handles it

### Adding a New Backend Profile Type
1. Update `APIProfile` interface in `lib/types.ts`
2. Create handler in `api/admin/profiles/`
3. Update proxy logic in `api/proxy.ts` to handle new profile type

### Modifying API Key Schema
1. Update `RedisKeyData` in `lib/types.ts`
2. Update all endpoints that read/write keys
3. Consider backward compatibility for existing keys in Redis
4. Update auto-migration logic in `lib/redis.ts` `getKeyData()` function if needed

### Debugging Request Flow
1. Check correlation ID in response headers: `X-Correlation-ID`
2. Search logs for correlation ID to trace entire request lifecycle
3. Use `/api/debug-key` endpoint to inspect key data without authentication (dev only)
4. Monitor concurrency status via `/api/admin/concurrency-status`
5. Check Redis directly using Upstash console for data verification

## Testing

The codebase doesn't include automated tests. Manual testing workflow:
1. Start local server: `npm run dev:server`
2. Test admin login: `POST http://localhost:3000/api/admin/login`
3. Create test API key via admin panel or CLI: `npm run key:create`
4. Test proxy endpoint: `POST http://localhost:3000/api/v1/chat/completions`
5. Monitor logs for errors and correlation IDs
6. Check concurrency tracking: `GET http://localhost:3000/api/admin/concurrency-status`

**Debug Scripts** (in root directory):
- `debug-key.js`: Direct Redis key inspection (requires env vars)
- `debug-key-via-api.js`: Test key validation via API endpoint

**Testing Tips**:
- Use correlation IDs (`X-Correlation-ID` header) to trace requests through logs
- Test streaming with `"stream": true` in request body
- Test tool use scenarios to verify usage counting only counts user messages
- Test waterfall fallback by setting low concurrency limits on default profile

## Troubleshooting

### 403 Forbidden Errors
See `FIX_403_FORBIDDEN.md` for detailed troubleshooting steps.

### Nginx Configuration
See `NGINX_CONFIGURATION.md` for reverse proxy setup.

### Settings Cache Issues
See `SETTINGS_CACHE.md` for cache management details.

### Concurrency Counter Stuck
If concurrency counters don't decrement properly (e.g., due to crashed requests):
1. Check current status: `GET /api/admin/concurrency-status`
2. Reset counters: `POST /api/admin/reset-concurrency`
3. Monitor logs for correlation IDs of stuck requests
4. Common causes: Server crashes during streaming, client disconnects not handled, network timeouts

### TypeScript Compilation Errors
Check `tsc_output.txt` and `tsc_output_2.txt` for previous compilation issues.

### Performance Issues
1. Check LRU cache hit rates in logs (should be ~90% for profiles/models)
2. Monitor Redis latency via Upstash dashboard
3. Review metrics endpoint: `GET /api/admin/metrics`
4. Verify Keep-Alive connections are being reused (check proxy logs)

### Common Errors
- **"Invalid API key"**: Key not found in Redis - verify key exists using `npm run key:list`
- **"Daily limit reached"**: User exceeded quota - check usage via admin panel
- **"Service Unavailable"**: No API sources configured - verify `API_KEY_GOC` env var and settings
- **"Request timeout"**: Backend took >5 minutes - check backend API status
- **Stream disconnects**: Check heartbeat logs, verify nginx timeout settings (should be >60s)

### Context Memory Issues
If users report "poor context memory" or "AI forgets previous messages":
- **This is NOT a proxy bug** - the proxy is stateless by design and forwards all messages unchanged
- Root causes are typically:
  1. Client application not sending full conversation history (most common)
  2. Backend API context handling issues
  3. System prompt too long (reduces available context window)
- Debug by logging `requestBody.messages.length` in `api/proxy.ts` to verify client is sending full history
- The proxy does NOT truncate, filter, or store conversation history
