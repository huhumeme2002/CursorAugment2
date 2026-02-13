# Usage Counting Fix - Summary

## Problem Identified

A single user prompt was being counted as **5 usage increments** instead of 1.

### Root Causes

1. **Usage incremented BEFORE validation** (line 168 in proxy.ts)
   - Usage was incremented immediately when a user message was detected
   - If validation failed later (400/422 errors), usage was NOT rolled back
   - Client retries after errors caused duplicate counts

2. **count_tokens endpoint incremented usage**
   - The `/v1/messages/count_tokens` endpoint went through the same proxy handler
   - It has `messages` in the request body, triggering usage increment
   - This is just a metadata call and shouldn't count against quota

3. **No idempotency protection**
   - Each retry from the client was treated as a new request
   - No deduplication mechanism

### Log Analysis

From the PM2 logs, a single user action resulted in:
- `correlationId f1680cd7`: count_tokens endpoint, 405 error, usage incremented ❌
- `correlationId 05ab3402`: messages endpoint, 422 error, usage incremented ❌
- `correlationId 28c44d3e`: messages endpoint, successful stream, usage incremented ✅
- `correlationId 69f0312b`: messages endpoint, successful stream, usage incremented ❌
- `correlationId b95444b3`: messages endpoint, successful stream, usage incremented ❌

**Total: 5 usage increments for 1 user action**

## Solution Implemented

### Changes Made

#### 1. Added `checkUsageLimit()` function in `lib/redis.ts`
- New function that checks usage WITHOUT incrementing
- Used for pre-validation before processing the request

#### 2. Modified `api/proxy.ts` - Deferred Usage Counting
- **Line 125-180**: Changed usage counting logic to be deferred
  - Added `isCountTokensEndpoint` check to exclude count_tokens endpoint
  - Changed `hasNewUserMessage` to `shouldCountUsage` flag
  - Replaced `incrementUsage()` with `checkUsageLimit()` for pre-validation
  - Usage is NO LONGER incremented at this point

#### 3. Added Usage Increment AFTER Successful Response
- **Streaming responses** (line 560): Added `await safeIncrementUsage()` after stream completes
- **Non-streaming responses** (line 590): Added usage increment after successful JSON response
- Usage is now only incremented when the upstream API returns a successful response

### Key Improvements

✅ **count_tokens endpoint excluded** - Metadata calls don't count against quota
✅ **Failed requests don't increment** - 4xx/5xx errors won't consume quota
✅ **Client retries handled correctly** - Only successful responses increment usage
✅ **Usage incremented once per successful request** - Deduplication via `usageIncremented` flag

## Deployment Instructions

1. **Backup current code** (if not already in git)
   ```bash
   git add .
   git commit -m "Backup before usage counting fix"
   ```

2. **Restart the PM2 service** (on your production server)
   ```bash
   pm2 restart cursor-augment
   # or
   pm2 restart all
   ```

3. **Monitor the logs**
   ```bash
   pm2 logs cursor-augment --lines 50
   ```

4. **Verify the fix**
   - Send a test request from Claude CLI
   - Check logs for "Usage counting check" message
   - Verify `shouldCountUsage` is true for actual user messages
   - Verify `isCountTokens` is true for count_tokens endpoint
   - Confirm "Usage incremented after successful response" appears ONLY after 2xx responses
   - Check admin dashboard to ensure usage count is correct

## Expected Log Output (After Fix)

```
[PROXY] Usage counting check: {
  endpoint: '/v1/messages?beta=true',
  isCountTokens: false,
  hasMessages: true,
  messageCount: 1,
  lastRole: 'user',
  lastContentType: 'string',
  shouldCountUsage: true
}
[PROXY] Starting stream
[PROXY] Usage incremented after successful response: { userToken: 'key-lomu...', usage: 1, limit: 100 }
[PROXY] Releasing concurrency for default (Reason: Stream complete)
```

For count_tokens endpoint:
```
[PROXY] Usage counting check: {
  endpoint: '/v1/messages/count_tokens?beta=true',
  isCountTokens: true,
  hasMessages: true,
  messageCount: 1,
  lastRole: 'user',
  lastContentType: 'string',
  shouldCountUsage: false
}
```

## Testing Checklist

- [ ] Single prompt increments usage by 1 (not 5)
- [ ] count_tokens endpoint does NOT increment usage
- [ ] Failed requests (4xx, 5xx) do NOT increment usage
- [ ] Tool result messages do NOT increment usage
- [ ] Streaming responses increment usage correctly
- [ ] Non-streaming responses increment usage correctly
- [ ] Admin dashboard shows correct usage counts

## Rollback Plan

If issues occur, revert the changes:
```bash
git revert HEAD
pm2 restart cursor-augment
```

## Files Modified

1. `lib/redis.ts` - Added `checkUsageLimit()` function
2. `api/proxy.ts` - Deferred usage counting logic

---

**Fix implemented by**: usage-counting-fix team
**Date**: 2026-02-13
