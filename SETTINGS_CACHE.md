# Settings Caching Implementation Guide

## Overview

Implemented in-memory caching for proxy settings to dramatically reduce Redis API calls and improve response times.

## Performance Impact

### Before Caching
- **Redis calls:** 1 per request
- **100 requests/minute:** 144,000 Redis calls/day
- **Latency per request:** +20ms (Redis network call)
- **Cost:** May exceed Upstash free tier (10,000/day)

### After Caching  
- **Redis calls:** 1 per 30 seconds
- **100 requests/minute:** ~2,880 Redis calls/day (98% reduction!)
- **Latency per request:** <1ms (memory read)
- **Cost:** Well within free tier

## Implementation Details

### Cache Variables

```typescript
// lib/redis.ts
let settingsCache: ProxySettings | null = null;
let settingsCacheTimestamp: number = 0;
const SETTINGS_CACHE_TTL = 30000; // 30 seconds
```

### Cached getSettings()

```typescript
export async function getSettings(): Promise<ProxySettings | null> {
    const now = Date.now();
    
    // Check cache validity
    if (settingsCache !== null && (now - settingsCacheTimestamp) < SETTINGS_CACHE_TTL) {
        console.log('[CACHE] Settings cache HIT');
        return settingsCache; // <1ms response
    }
    
    // Cache miss - fetch from Redis
    console.log('[CACHE] Settings cache MISS - fetching from Redis');
    const settings = await redis.get(SETTINGS_KEY);
    
    // Update cache
    settingsCache = settings;
    settingsCacheTimestamp = now;
    
    return settings;
}
```

### Cache Invalidation

**Automatic (Time-based):**
- Cache expires after 30 seconds
- Next request triggers fresh Redis fetch

**Manual (API endpoint):**

```bash
# Clear cache immediately
POST /api/admin/cache/clear
Authorization: Bearer <jwt-token>
```

**Automatic on Settings Update:**
- `POST /api/admin/settings/save` automatically calls `clearSettingsCache()`
- Ensures new settings take effect immediately

## What is Cached vs Not Cached

| Data Type | Cached? | Why |
|-----------|---------|-----|
| **Settings** (api_url, model_display) | ✅ YES (30s) | Changes rarely, safe to cache |
| **Backup Profiles** | ❌ NO | Need real-time for waterfall routing |
| **Concurrency Counts** | ❌ NO | Must be real-time for accurate load balancing |
| **API Profiles** | ❌ NO | User might change selection anytime |
| **Key Data** | ❌ NO | Daily limits must be accurate |

## Usage

### Normal Operation

```typescript
// First request (cache MISS)
const settings = await getSettings(); // ~20ms, fetches from Redis
// [CACHE] Settings cache MISS - fetching from Redis

// Subsequent requests within 30s (cache HIT)
const settings2 = await getSettings(); // <1ms, returns from memory
// [CACHE] Settings cache HIT
```

### After Admin Updates Settings

```typescript
// Admin saves new settings
POST /api/admin/settings/save
{
  "api_url": "https://new-api.com/v1",
  "api_key": "new-key"
}

// Response:
// [ADMIN] Settings saved and cache cleared

// Next request gets fresh data immediately
const settings = await getSettings(); // Fetches new settings
```

### Manual Cache Clear

```bash
curl -X POST https://your-domain.com/api/admin/cache/clear \
  -H "Authorization: Bearer <jwt-token>"

# Response:
{
  "success": true,
  "message": "Settings cache cleared successfully"
}
```

## Monitoring

### Check Cache Behavior in Logs

```bash
pm2 logs | grep CACHE

# You'll see:
[CACHE] Settings cache MISS - fetching from Redis  # Every 30s
[CACHE] Settings cache HIT  # Most requests
[CACHE] Settings cache cleared  # When admin updates
```

### Expected Pattern

Normal traffic (10 requests in 30s):
```
Request 1:  [CACHE] Settings cache MISS  ← Redis call
Request 2:  [CACHE] Settings cache HIT
Request 3:  [CACHE] Settings cache HIT
...
Request 10: [CACHE] Settings cache HIT
[30 seconds later]
Request 11: [CACHE] Settings cache MISS  ← Redis call
Request 12: [CACHE] Settings cache HIT
```

## Trade-offs

### Advantages ✅
- 98% reduction in Redis calls
- 40x faster settings retrieval  
- Lower costs (stay in free tier)
- Reduced Redis load
- Server more resilient to Redis issues

### Trade-offs ⚠️
- Settings changes need up to 30s to propagate  
  - **Solution:** Auto-clear on save, or manual clear endpoint
- Uses ~1KB RAM per server instance
  - **Impact:** Negligible

## Testing

### Test 1: Cache Works

```bash
# Start server
npm run dev:server

# Make first request - should see CACHE MISS
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer test-key" \
  -d '{"model":"Claude-Opus-4.5-VIP","messages":[...]}'

# Check logs: [CACHE] Settings cache MISS

# Make second request within 30s - should see CACHE HIT  
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer test-key" \
  -d '{"model":"Claude-Opus-4.5-VIP","messages":[...]}'

# Check logs: [CACHE] Settings cache HIT
```

### Test 2: Cache Expires

```bash
# Make request
curl http://localhost:3000/v1/chat/completions ...
# [CACHE] Settings cache MISS

# Wait  31 seconds
sleep 31

# Make request again - should MISS (cache expired)
curl http://localhost:3000/v1/chat/completions ...
# [CACHE] Settings cache MISS
```

### Test 3: Manual Clear Works

```bash
# Make request to populate cache
curl http://localhost:3000/v1/chat/completions ...
# [CACHE] Settings cache MISS

# Cache should be populated now
curl http://localhost:3000/v1/chat/completions ...
# [CACHE] Settings cache HIT

# Clear cache manually
curl -X POST http://localhost:3000/api/admin/cache/clear \
  -H "Authorization: Bearer <admin-jwt>"
# [CACHE] Settings cache cleared

# Next request should MISS
curl http://localhost:3000/v1/chat/completions ...
# [CACHE] Settings cache MISS
```

## Files Modified

| File | Changes |
|------|---------|
| `lib/redis.ts` | Added cache variables, modified `getSettings()`, added `clearSettingsCache()` |
| `api/admin/settings/save.ts` | Added `clearSettingsCache()` call after saving |
| `api/admin/cache/clear.ts` | New endpoint for manual cache clearing |

## Deployment

```bash
# Pull latest code
git pull origin main

# Restart server
pm2 restart all

# Verify cache working
pm2 logs | grep CACHE
```

Expected behavior after deployment:
- First few requests: `[CACHE] Settings cache MISS`
- Subsequent requests: `[CACHE] Settings cache HIT`
- Every 30s: One MISS, then HITs again

## Troubleshooting

### Cache Not Working?

Check logs for:
```bash
pm2 logs | grep CACHE
```

If you don't see any `[CACHE]` messages:
1. Verify you deployed latest code: `git log -1`
2. Check TypeScript compiled: `npx tsc --noEmit`
3. Restart server: `pm2 restart all`

### Settings Not Updating?

If admin changes settings but they don't apply:
1. Check cache was cleared: Look for `[ADMIN] Settings saved and cache cleared` in logs
2. Manually clear cache: `POST /api/admin/cache/clear`
3. Wait 30s for auto-expiry

### Too Many Redis Calls?

Monitor with Upstash dashboard:
- Should see ~2,880 calls/day instead of 144,000
- If still high, cache might not be working properly

## Summary

✅ **Implemented:** In-memory caching for proxy settings  
✅ **Performance:** 98% reduction in Redis calls, 40x faster  
✅ **Safe:** Only caches stable data, real-time data stays real-time  
✅ **Automatic:** Cache clears on settings save  
✅ **Manual Control:** Admin can force cache clear via API
