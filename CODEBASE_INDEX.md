# CursorAugment2 Codebase Index

**Project**: Vercel AI Proxy with Admin Panel  
**Purpose**: Multi-API proxy system for AI services with admin dashboard, key management, and per-user rate limiting

---

## 📊 Project Overview

A TypeScript-based Express server that proxies API requests to multiple AI backends (Claude, GPT, Gemini, etc.) with:
- ✅ Admin panel for managing API keys
- ✅ Redis-based session tracking and rate limiting
- ✅ Model transformation and routing
- ✅ OpenAI-compatible API interface
- ✅ JWT-based admin authentication
- ✅ Streaming response support

---

## 🗂️ Directory Structure

### Root Level Files
| File | Purpose |
|------|---------|
| `server.ts` | Express server entry point with dynamic API routing |
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript configuration |
| `vercel.json` | Vercel deployment config with CORS setup |
| `ecosystem.config.js` | PM2 configuration for production |

### `/api` - API Endpoints (Dynamic Route Handler)
Server dynamically maps `/api/path/to/route` → `./api/path/to/route.ts`

#### `/api/admin/` - Admin Management APIs
**Protected by JWT authentication**

- **`/admin/login.ts`** - Authenticate admin user
  - POST request validation
  - Returns JWT token (24h expiry)

- **`/admin/keys/`** - API Key Management
  - `create.ts` - Create new API key with expiry date
  - `list.ts` - List all API keys and their usage
  - `delete.ts` - Delete API key

- **`/admin/profiles/`** - API Profile Management (Backend Configuration)
  - `create.ts` - Create new API profile (provider configuration)
  - `list.ts` - List all backend profiles
  - `update.ts` - Update profile settings
  - `delete.ts` - Delete profile

- **`/admin/backup-profiles/`** - Backup Profile Management
  - `create.ts` - Create fallback profile
  - `list.ts` - List backup profiles
  - `delete.ts` - Delete backup profile

- **`/admin/models/`** - Model Configuration
  - `save.ts` - Save per-model system prompts
  - `list.ts` - List model configurations
  - `delete.ts` - Delete model config

- **`/admin/settings/`** - Global Settings
  - `get.ts` - Get global settings
  - `save.ts` - Save/update settings

- **`/admin/metrics.ts`** - Performance metrics and usage statistics
- **`/admin/concurrency-status.ts`** - Current concurrent request count
- **`/admin/reset-concurrency.ts`** - Reset concurrency counter
- **`/admin/cache/clear.ts`** - Clear Redis cache

#### `/api/user/` - User-Facing APIs
**Protected by API key authentication**

- `status.ts` - Check current user status and limits
- `profiles.ts` - List available profiles for user
- `select-profile.ts` - Switch to different backend profile
- `model.ts` - Get/switch current model

#### `/api/v1/chat/`  - OpenAI-Compatible Endpoint
- `completions.ts` - Main AI chat completion endpoint (OpenAI format)

#### `/api/` - Core Endpoints
- `proxy.ts` - Main proxy handler (routes to backend APIs)
- `debug-key.ts` - Debug endpoint for key validation

---

## 📚 `/lib` - Shared Utilities

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript interfaces for core models |
| `auth.ts` | JWT authentication and validation |
| `redis.ts` | Redis connection and helper functions |
| `logger.ts` | Logging utility |
| `metrics.ts` | Metrics tracking and aggregation |
| `utils.ts` | General utility functions |

### Key Types (from `types.ts`)

```typescript
Session {          // Concurrent user tracking
  session_id
  device_id
  ip_address
  created_at, last_activity
  request_count
  rate_window_start
}

RedisKeyData {     // API key storage schema
  expiry
  daily_limit
  usage_today { date, count }
  session_timeout_minutes
  selected_model
  selected_api_profile_id
}

APIProfile {       // Backend API configuration
  id, name
  api_key, api_url
  model_actual
  capabilities
  speed
  is_active
}

BackupProfile extends APIProfile {
  concurrency_limit
}

OpenAIRequest {    // Standard chat request
  model, messages[]
  stream, temperature
  max_tokens, etc.
}
```

---

## 🎨 `/public` - Frontend Assets

#### `/public/admin/`
- `index.html` - Admin dashboard UI
- `app.js` - Dashboard JavaScript logic
- `metrics.js` - Real-time metrics display

#### `/public/user/`
- `index.html` - User profile management interface

#### `/public/`
- `index.html` - Home page

---

## 📜 `/scripts` - CLI Utilities (Node.js scripts)

| Script | Purpose |
|--------|---------|
| `create-key.js` | Create API key from CLI |
| `list-keys.js` | List all keys from CLI |
| `delete-key.js` | Delete key from CLI |

---

## 🔑 Key Concepts

### Request Flow
```
Client Request
    ↓
server.ts (Dynamic Route Handler)
    ↓
/api/v1/chat/completions.ts (or other routes)
    ↓
lib/auth.ts (Validate API key)
    ↓
api/proxy.ts (Transform & forward to backend)
    ↓
Backend API (Claude, GPT, Gemini, etc.)
    ↓
Response → Stream to Client
```

### Authentication Layers
1. **API Key Authentication** (Users)
   - Header: `Authorization: Bearer {api_key}`
   - Validated in endpoint handlers
   - Rate limited per key/session

2. **JWT Authentication** (Admin)
   - POST /api/admin/login with password
   - Returns JWT token (24h expiry)
   - Used for admin panel endpoints

### Data Storage (Redis)
- **Keys**: `api_key:{key_id}` → RedisKeyData
- **Sessions**: `session:{session_id}` → Session data
- **Models**: `model_config:{model_name}` → ModelConfig
- **Settings**: `settings` → Global configuration

### Rate Limiting Strategy
- Per-day limits stored in RedisKeyData
- Session-based concurrent user tracking
- Device ID generation for activation tracking
- Waterfall fallback to backup profiles on concurrency limit

---

## 🚀 Server Architecture (server.ts)

### Middleware Stack
1. `dotenv/config` - Load environment variables
2. `express.cors()` - Enable CORS
3. `express.json()` - JSON parser (10mb limit)
4. `express.static('public')` - Serve static files

### Route Handlers
1. **GET /health** - Server health check
2. **GET /admin** - Serve admin dashboard
3. **ALL /api/\*** - Dynamic API router
   - Maps to `./api/path/to/route.ts` files
   - Requires default export function
   - Error handling with detailed responses
4. **ALL /v1/\*** - OpenAI-compatible routes (legacy)

### Special Configuration
- **Timeout**: 5 minutes (300s) to handle long AI generations
- **Payload**: 10MB limit for large requests
- **Dynamic Routing**: Requires .ts files with default export

---

## 📋 Environment Variables Required

```bash
# API Keys & Services
API_KEY_GOC=                          # Primary API key
UPSTASH_REDIS_REST_URL=              # Redis URL
UPSTASH_REDIS_REST_TOKEN=            # Redis token
JWT_SECRET=                          # 32-char hex for JWT
ADMIN_PASSWORD=                      # Admin login password

# Optional
NODE_ENV=production|development
PORT=3000
```

---

## 🔄 Data Flow Examples

### Creating an API Key
```
Admin Panel → POST /api/admin/keys/create
           → Validate JWT token
           → Generate unique key ID
           → Store in Redis with expiry
           → Return key to admin
```

### Making an API Request
```
Client → POST /api/v1/chat/completions
      → Extract API key from header
      → Validate key & daily limit
      → Create/track session
      → Transform model name
      → Forward to backend (proxy.ts)
      → Stream response back to client
```

### Admin Authentication
```
Browser → POST /api/admin/login (password)
       → Validate password
       → Create JWT token
       → Return token
       → Store in localStorage
       → Use in subsequent requests
```

---

## 🛠️ Key Files Dependencies

```
server.ts
├── api/proxy.ts (special case handler)
├── api/admin/* (routes)
├── api/v1/chat/completions.ts
└── public/* (static files)

api/v1/chat/completions.ts
├── lib/auth.ts (validate API key)
├── lib/redis.ts (get key data & limits)
├── lib/types.ts (type definitions)
└── api/proxy.ts (forward to backend)

lib/auth.ts
├── jsonwebtoken (JWT handling)
└── env variables (JWT_SECRET, ADMIN_PASSWORD)

lib/redis.ts
├── node-redis or fetch (REST API)
├── UPSTASH_REDIS_REST_URL/TOKEN
└── lib/types.ts (data schemas)
```

---

## 📊 Database Schema (Redis)

### API Key Entry
```
Key: api_key:{key_id}
Value: {
  "expiry": "2026-12-31",
  "daily_limit": 100,
  "usage_today": {
    "date": "2025-08-15",
    "count": 45
  },
  "selected_model": "claude-opus",
  "selected_api_profile_id": "profile-uuid"
}
```

### Active Session Entry
```
Key: session:{session_id}
Value: {
  "session_id": "...",
  "device_id": "...",
  "ip_address": "...",
  "created_at": 1692158400000,
  "last_activity": 1692162000000,
  "request_count": 5,
  "rate_window_start": 1692158400000
}
```

### Model Configuration
```
Key: model_config:{model_name}
Value: {
  "name": "Claude Opus 4.5",
  "system_prompt": "You are a helpful assistant..."
}
```

---

## 🎯 Core Features Implementation

| Feature | Files |
|---------|-------|
| **API Routing** | server.ts, api/* |
| **Authentication** | lib/auth.ts, api/admin/login.ts |
| **Key Management** | api/admin/keys/*, lib/redis.ts |
| **Rate Limiting** | lib/redis.ts, completions.ts |
| **Model Transform** | lib/utils.ts, proxy.ts |
| **Streaming** | api/v1/chat/completions.ts |
| **Admin Dashboard** | public/admin/index.html, public/admin/app.js |
| **Metrics** | lib/metrics.ts, api/admin/metrics.ts |

---

## 📝 Configuration Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript compiler options |
| `vercel.json` | Vercel deployment settings & API routes |
| `package.json` | Dependencies, scripts, project metadata |
| `ecosystem.config.js` | PM2 process manager configuration |
| `.env` / `.env.local` | Local environment variables (git-ignored) |

---

## 🔍 Important Implementation Details

1. **Dynamic Route Loading**: Uses `require()` for module loading in server.ts
2. **Streaming Support**: Native Node.js streaming for AI responses
3. **Redis Integration**: REST API based (Upstash) for Vercel compatibility
4. **Error Handling**: Detailed error messages with stack traces for debugging
5. **Backward Compatibility**: Support for legacy activation-based schema
6. **Device ID**: Server-generated for tracking concurrent users

---

## 📈 Performance Considerations

- **Timeout**: 5 minutes for long-running AI generations
- **Rate Limiting**: Per-session, per-day quota system
- **Caching**: Redis for key metadata and session tracking
- **Concurrency**: Tracked via sessions, with fallback profiles
- **Payload Size**: 10MB limit for requests/responses

---

## 🚀 Deployment

**Platform**: Vercel  
**Runtime**: Node.js with TypeScript support  
**Database**: Upstash Redis (REST API)  
**Domains**: Custom domain via Vercel

---

## 📞 Common Tasks

### Add New Admin Endpoint
1. Create file: `api/admin/{feature}/{action}.ts`
2. Implement with JWT validation
3. Export default async handler function
4. Server auto-routes via dynamic handler

### Add New Backend Profile Type
1. Update `APIProfile` interface in `lib/types.ts`
2. Create handler in `api/admin/profiles/`
3. Update proxy logic in `api/proxy.ts`

### Modify API Key Schema
1. Update `RedisKeyData` in `lib/types.ts`
2. Update all endpoints that read/write keys
3. Consider backward compatibility migration

---

**Last Updated**: Based on codebase structure as of session start  
**Status**: Active development with modular architecture
