import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Agent as HttpsAgent } from 'https';
import { getKeyData, isExpired, getSettings, incrementUsage, getAPIProfile, getBackupProfiles, incrementConcurrency, decrementConcurrency, validateKeyWithUsage } from '../lib/redis';
import { generateCorrelationId, setCorrelationId, logInfo, logError, createPerformanceTracker } from '../lib/logger';
import { metrics } from '../lib/metrics';

// =====================
// HTTP AGENT WITH KEEP-ALIVE
// =====================
// Reuse TCP connections to reduce SSL handshake overhead
// Performance: ~100ms per request → ~0ms for reused connections
const httpsAgent = new HttpsAgent({
    keepAlive: true,
    keepAliveMsecs: 30000,   // Keep idle connections alive for 30s
    maxSockets: 50,           // Max concurrent connections per host
    maxFreeSockets: 10,       // Keep 10 idle connections ready
    timeout: 60000,           // Socket timeout: 60s
});

// Default API base URL - match CloudFlare Worker targetBase
const DEFAULT_API_BASE = 'https://code.newcli.com/claude/droid/v1';

// Version marker for deployment verification
const PROXY_VERSION = '3.2.0-monitored';

/**
 * Build upstream URL matching CloudFlare Worker logic
 * @param apiBase - Base URL (e.g., "https://code.newcli.com/claude/droid" or "https://code.newcli.com/claude/droid/v1")
 * @param clientPath - Path from client request (e.g., "/v1/chat/completions" or "/v1/messages")
 * @returns Final upstream URL
 */
function buildUpstreamUrl(apiBase: string, clientPath: string): string {
    // Remove trailing slash from base
    if (apiBase.endsWith('/')) {
        apiBase = apiBase.slice(0, -1);
    }

    // CloudFlare Worker logic:
    // const targetBase = "https://code.newcli.com/claude/droid/v1";
    // let targetPath = url.pathname.startsWith("/v1") ? url.pathname.replace("/v1", "") : url.pathname;
    // const proxyUrl = targetBase + targetPath + url.search;

    let finalUrl: string;
    if (apiBase.endsWith('/v1')) {
        // Base already has /v1, remove /v1 from client path
        const pathWithoutV1 = clientPath.startsWith('/v1') ? clientPath.replace('/v1', '') : clientPath;
        finalUrl = `${apiBase}${pathWithoutV1}`;
    } else {
        // Base doesn't have /v1, append full client path
        finalUrl = `${apiBase}${clientPath}`;
    }

    return finalUrl;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Setup correlation ID and performance tracking
    const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId();
    setCorrelationId(correlationId);
    res.setHeader('X-Correlation-ID', correlationId);

    const perfTracker = createPerformanceTracker('Proxy Request');
    const requestStart = Date.now();

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get client path from request URL
        const clientPath = req.url || '/v1/chat/completions';

        logInfo('Proxy request started', {
            correlationId,
            method: req.method,
            endpoint: clientPath,
            version: PROXY_VERSION,
        });

        // Log client info for debugging
        const forwarded = req.headers['x-forwarded-for'];
        const realIp = req.headers['x-real-ip'];
        const clientIP = forwarded
            ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0])
            : (realIp ? (Array.isArray(realIp) ? realIp[0] : realIp) : 'unknown-ip');
        console.log('[PROXY] Client info:', {
            ip: clientIP,
            userAgent: req.headers['user-agent']?.substring(0, 50) + '...'
        });

        // ====================
        // 1. AUTHENTICATION
        // ====================
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const userToken = authHeader.replace('Bearer ', '');
        console.log('[PROXY] Using key:', userToken); // Full key for debugging

        const keyData = await getKeyData(userToken);
        if (!keyData) {
            console.log('[PROXY] Key not found in Redis:', userToken);
            return res.status(401).json({ error: 'Invalid API key' });
        }

        // ====================
        // 2. EXPIRY CHECK
        // ====================
        if (isExpired(keyData.expiry)) {
            return res.status(403).json({ error: 'API key has expired' });
        }

        // ====================
        // 3. DAILY LIMIT CHECK (only count user messages, not tool calls)
        // ====================
        const requestBody = req.body;

        // Check if this request contains a new user message
        // Tool results and assistant messages should NOT be counted
        let hasNewUserMessage = false;

        if (requestBody.messages && Array.isArray(requestBody.messages)) {
            const lastMessage = requestBody.messages[requestBody.messages.length - 1];

            // Check if it's actually a user message (not tool_result)
            // In Anthropic API, tool_result has role=user but content contains type=tool_result
            if (lastMessage?.role === 'user') {
                const content = lastMessage.content;

                // Check if content is a tool_result
                // Content can be string (actual user message) or array of content blocks
                if (typeof content === 'string') {
                    // Simple string content = real user message
                    hasNewUserMessage = true;
                } else if (Array.isArray(content)) {
                    // Check if any block is a tool_result
                    const hasToolResult = content.some(
                        (block: any) => block.type === 'tool_result'
                    );
                    // Only count if there's NO tool_result in content
                    hasNewUserMessage = !hasToolResult;
                } else {
                    // Single object content - check type
                    hasNewUserMessage = content?.type !== 'tool_result';
                }
            }
        }

        console.log('[PROXY] Message check:', {
            hasMessages: !!requestBody.messages,
            messageCount: requestBody.messages?.length || 0,
            lastRole: requestBody.messages?.[requestBody.messages?.length - 1]?.role || 'none',
            lastContentType: typeof requestBody.messages?.[requestBody.messages?.length - 1]?.content,
            willCount: hasNewUserMessage
        });

        // Only increment usage for actual user prompts
        let usageResult = { allowed: true, currentUsage: 0, limit: keyData.daily_limit };

        if (hasNewUserMessage) {
            usageResult = await incrementUsage(userToken);

            if (!usageResult.allowed) {
                console.error('[PROXY] BLOCKING REQUEST - Daily limit reached:', {
                    userToken: userToken.substring(0, 8) + '...',
                    clientIP,
                    usage: usageResult.currentUsage,
                    limit: usageResult.limit
                });
                return res.status(429).json({
                    error: 'Daily limit reached',
                    message: `This key has reached its daily limit of ${usageResult.limit} requests. Please try again tomorrow.`,
                    current_usage: usageResult.currentUsage,
                    daily_limit: usageResult.limit
                });
            }

            console.log('[PROXY] Usage incremented:', {
                userToken: userToken.substring(0, 8) + '...',
                usage: usageResult.currentUsage,
                limit: usageResult.limit
            });
        } else {
            console.log('[PROXY] Skipping usage count (not a user message)');
        }

        // ====================
        // 4. LOAD SETTINGS & WATERFALL PREPARATION
        // ====================
        const settings = await getSettings();
        const defaultApiBase = settings?.api_url || DEFAULT_API_BASE;
        const defaultApiKey = settings?.api_key || process.env.API_KEY_GOC;
        const defaultConcurrencyLimit = settings?.concurrency_limit || 100; // Default to 100 if not set

        console.log('[PROXY] Settings loaded:', {
            hasCustomUrl: !!settings?.api_url,
            concurrencyLimit: defaultConcurrencyLimit
        });

        // Determine if we are using a specific User Profile (overrides waterfall)
        let userSelectedProfileId = keyData.selected_api_profile_id;
        let activeSource: {
            id: string;
            type: 'default' | 'profile' | 'backup';
            apiBase: string;
            apiKey: string;
            modelActual?: string;
            name: string;
        } | null = null;

        let concurrencyIdToDecrement: string | null = null;

        // -----------------------------------------------------
        // Strategy Selection
        // -----------------------------------------------------

        if (userSelectedProfileId) {
            // STRATEGY A: User Selected Profile (Direct, no waterfall fallback)
            const profile = await getAPIProfile(userSelectedProfileId);
            if (profile && profile.is_active) {
                activeSource = {
                    id: profile.id,
                    type: 'profile',
                    apiBase: profile.api_url,
                    apiKey: profile.api_key,
                    modelActual: profile.model_actual,
                    name: `Profile: ${profile.name}`
                };
                console.log(`[PROXY] Using User Selected Profile: ${profile.name}`);
            } else {
                console.warn(`[PROXY] Selected profile ${userSelectedProfileId} not found/inactive. Reverting to Waterfall.`);
                // Fall through to Strategy B
            }
        }

        if (!activeSource) {
            // STRATEGY B: Waterfall (Default -> Backup 1 -> Backup 2)

            // 1. Try Default Source
            if (defaultApiKey) {
                const numericLimit = Number(defaultConcurrencyLimit) || 100;
                const check = await incrementConcurrency('default', numericLimit);
                console.log(`[PROXY] Waterfall Step 1: Default check - Current: ${check.current}, Limit: ${numericLimit}, Allowed: ${check.allowed}`);

                if (check.allowed) {
                    activeSource = {
                        id: 'default',
                        type: 'default',
                        apiBase: defaultApiBase,
                        apiKey: defaultApiKey,
                        modelActual: settings?.model_actual,
                        name: 'Default API'
                    };
                    concurrencyIdToDecrement = 'default';
                    console.log(`[PROXY] ✅ Using DEFAULT API`);
                } else {
                    console.log(`[PROXY] ❌ Default API full, trying backups...`);
                }
            }

            // 2. Try Backups if Default failed or wasn't configured
            if (!activeSource) {
                const backups = await getBackupProfiles();
                console.log(`[PROXY] Waterfall Step 2: Found ${backups.length} backup profile(s)`);

                for (const backup of backups) {
                    console.log(`[PROXY] Checking backup: ${backup.name}, Active: ${backup.is_active}, Limit: ${backup.concurrency_limit}`);
                    if (!backup.is_active) {
                        console.log(`[PROXY] ⏭️ Skipping ${backup.name} (inactive)`);
                        continue;
                    }

                    const limit = Number(backup.concurrency_limit) || 10;
                    const check = await incrementConcurrency(backup.id, limit);
                    console.log(`[PROXY] Backup ${backup.name} - Current: ${check.current}, Limit: ${limit}, Allowed: ${check.allowed}`);

                    if (check.allowed) {
                        activeSource = {
                            id: backup.id,
                            type: 'backup',
                            apiBase: backup.api_url,
                            apiKey: backup.api_key,
                            modelActual: backup.model_actual,
                            name: `Backup: ${backup.name}`
                        };
                        concurrencyIdToDecrement = backup.id;
                        console.log(`[PROXY] ✅ Using BACKUP: ${backup.name}`);
                        break; // Found a source, stop looking
                    } else {
                        console.log(`[PROXY] ❌ Backup ${backup.name} full`);
                    }
                }
            }

            // 3. Fallback to Default API even if at capacity (allow queueing)
            if (!activeSource && defaultApiKey) {
                console.log(`[PROXY] Waterfall Step 3: All sources exhausted, falling back to DEFAULT (will queue)`);
                activeSource = {
                    id: 'default',
                    type: 'default',
                    apiBase: defaultApiBase,
                    apiKey: defaultApiKey,
                    modelActual: settings?.model_actual,
                    name: 'Default API (Queued)'
                };
                // Don't increment concurrency here - we're already at limit
            }
        }

        // Final check: Did we get a source?
        if (!activeSource) {
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'No API sources are configured. Please contact the administrator.'
            });
        }

        // ====================
        // 5. REQUEST PREPARATION
        // ====================

        const apiBase = activeSource.apiBase;
        const apiKey = activeSource.apiKey;
        const profileModelActual = activeSource.modelActual;

        console.log(`[PROXY] Final Source: ${activeSource.name}`);

        const apiUrl = buildUpstreamUrl(apiBase, clientPath);
        console.log('[PROXY] Final upstream URL:', apiUrl);


        // ====================
        // 6. MODEL VALIDATION & TRANSFORMATION
        // ====================

        // Transform model name using settings (prioritize profile's model_actual)
        const modelDisplay = settings?.model_display || 'Claude-Opus-4.5-VIP';
        const modelActual = activeSource.modelActual || settings?.model_actual || 'claude-3-5-haiku-20241022';

        // ... (Existing metadata removal logic) ...
        if (requestBody.metadata) delete requestBody.metadata;

        // ... (Existing model validation) ...
        if (requestBody.model !== modelDisplay) {
            // Decrement before returning error
            if (concurrencyIdToDecrement) await decrementConcurrency(concurrencyIdToDecrement);

            return res.status(400).json({
                error: 'Invalid model',
                message: `Model "${requestBody.model}" is not available. Please use "${modelDisplay}".`,
                type: 'invalid_request_error'
            });
        }

        // Transform to actual model for upstream
        requestBody.model = modelActual;
        console.log('[PROXY] Model transformed to:', modelActual);

        // ====================
        // 7. SYSTEM PROMPT INJECTION
        // ====================
        // ... (Existing System Prompt Logic - reusing settings) ...
        // Note: activeSource is setup, but system prompt logic relies on 'settings'
        // If we want backup profiles to have their own system prompts, we'd need to extend that.
        // For now, retaining Global/Model-specific system prompt logic from settings.

        let systemPrompt = settings?.system_prompt;
        const keySelectedModel = keyData.selected_model;
        if (keySelectedModel && settings?.models?.[keySelectedModel]) {
            systemPrompt = settings.models[keySelectedModel].system_prompt;
        }

        // ... (Existing System Prompt Injection Checks) ...
        if (systemPrompt && typeof systemPrompt === 'string') {
            systemPrompt = systemPrompt.trim();
            if (!systemPrompt) {
                systemPrompt = undefined;
            } else {
                const MAX_SYSTEM_PROMPT_LENGTH = 10000;
                if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
                    systemPrompt = systemPrompt.substring(0, MAX_SYSTEM_PROMPT_LENGTH);
                }
            }
        }

        // Check if we should bypass system prompt injection for supperapi.store
        const shouldBypassSystemPrompt = apiBase.includes('supperapi.store');

        console.log('[PROXY] System prompt check:', {
            apiBase,
            shouldBypass: shouldBypassSystemPrompt,
            hasSystemPrompt: !!systemPrompt
        });

        if (shouldBypassSystemPrompt) {
            console.log('[PROXY] ✅ Bypassing system prompt injection for supperapi.store URL:', apiBase);
        }

        if (systemPrompt && !shouldBypassSystemPrompt) {
            const isAnthropic = 'system' in requestBody || clientPath.includes('/messages');
            if (isAnthropic) {
                requestBody.system = systemPrompt;
            } else if (requestBody.messages && Array.isArray(requestBody.messages)) {
                const hasSystemMessage = requestBody.messages.some((msg: any) => msg.role === 'system');
                if (hasSystemMessage) {
                    requestBody.messages = requestBody.messages.map((msg: any) => msg.role === 'system' ? { role: 'system', content: systemPrompt } : msg);
                } else {
                    requestBody.messages.unshift({ role: 'system', content: systemPrompt });
                }
            }
        }


        // ====================
        // 8. EXECUTE REQUEST
        // ====================
        console.log('[PROXY] Forwarding request:', {
            method: 'POST',
            url: apiUrl,
            hasAuth: !!apiKey,
            stream: requestBody.stream
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.log('[PROXY] Request timeout - aborting');
            controller.abort();
        }, 300000); // 5 minutes to match server timeout

        let response: Response;
        try {
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'text/event-stream',
                    'Connection': 'keep-alive',
                    // Claude Code identification headers - helps upstream API recognize this as Claude Code
                    'User-Agent': 'claude-code/1.0.42',
                    'anthropic-client-version': '1.0.42',
                    'x-api-key': apiKey,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
                // @ts-ignore - Node.js fetch supports agent option
                agent: httpsAgent,
            });
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (concurrencyIdToDecrement) await decrementConcurrency(concurrencyIdToDecrement);

            console.error('[PROXY] Fetch error:', fetchError);
            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                return res.status(504).json({ error: 'Request timeout' });
            }
            throw fetchError;
        }
        clearTimeout(timeoutId);

        if (!response.ok) {
            // Decrement immediately on error
            if (concurrencyIdToDecrement) await decrementConcurrency(concurrencyIdToDecrement);

            const errorText = await response.text();
            console.error('[PROXY] Upstream error:', { status: response.status, error: errorText });
            return res.status(response.status).json({ error: 'Upstream API error', details: errorText });
        }

        // ====================
        // 9. HANDLE RESPONSE (Stream or JSON)
        // ====================

        if (requestBody.stream) {
            // ... (Stream logic) ...
            console.log('[PROXY] Starting stream');
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Send initial connection confirmation to prevent immediate timeout
            res.write(':connected\n\n');

            // Helper to ensure we only decrement once
            const safeDecrement = async (reason: string) => {
                if (concurrencyIdToDecrement) {
                    console.log(`[PROXY] Releasing concurrency for ${concurrencyIdToDecrement} (Reason: ${reason})`);
                    const id = concurrencyIdToDecrement;
                    concurrencyIdToDecrement = null; // Prevent double decrement
                    await decrementConcurrency(id);
                }
            };

            // Setup heartbeat to prevent nginx timeout during long thinking periods
            // SSE comments (lines starting with :) are ignored by clients
            const heartbeatInterval = setInterval(() => {
                if (!res.writableEnded) {
                    try {
                        res.write(':heartbeat\n\n');
                        console.log('[PROXY] Sent heartbeat to keep connection alive');
                    } catch (e) {
                        console.error('[PROXY] Failed to send heartbeat:', e);
                        clearInterval(heartbeatInterval);
                    }
                }
            }, 15000); // Every 15 seconds

            // 1. Handle Client Disconnect
            req.on('close', () => {
                clearInterval(heartbeatInterval);
                safeDecrement('Client closed connection');
            });

            // 2. Handle Response Finish (Success) - Fallback if manual decrement missed
            res.on('finish', () => {
                clearInterval(heartbeatInterval);
                safeDecrement('Response finished');
            });

            // 3. Handle Response Error
            res.on('error', () => {
                clearInterval(heartbeatInterval);
                safeDecrement('Response error');
            });

            const reader = response.body?.getReader();
            if (!reader) {
                clearInterval(heartbeatInterval);
                await safeDecrement('Failed to get reader');
                return res.status(500).json({ error: 'Failed to read stream' });
            }

            const decoder = new TextDecoder();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        // Stream finished successfully
                        clearInterval(heartbeatInterval);
                        await safeDecrement('Stream complete');

                        // Track successful streaming request
                        const duration = Date.now() - requestStart;
                        metrics.recordRequest(req.url || '/unknown', true, duration);

                        res.end();
                        break;
                    }

                    let chunk = decoder.decode(value, { stream: true });
                    // Basic transformation
                    if (modelDisplay && modelActual) {
                        chunk = chunk.replace(new RegExp(modelActual, 'g'), modelDisplay);
                    }
                    chunk = chunk.replace(/Claude Code/g, 'Claude Opus');

                    res.write(chunk);
                }
            } catch (streamError) {
                console.error('Stream error:', streamError);
                clearInterval(heartbeatInterval);
                await safeDecrement('Stream error');
                res.end();
            }

        } else {
            // Non-stream
            const data = await response.json();
            // Decrement immediately after getting full response
            if (concurrencyIdToDecrement) await decrementConcurrency(concurrencyIdToDecrement);

            // Track successful non-streaming request
            const duration = Date.now() - requestStart;
            metrics.recordRequest(req.url || '/unknown', true, duration);

            // ... (Replacements) ...
            const modifiedData = JSON.parse(
                JSON.stringify(data).replace(new RegExp(modelActual, 'g'), modelDisplay)
            );
            return res.status(200).json(modifiedData);
        }
    } catch (error) {
        const duration = Date.now() - requestStart;

        logError('Proxy request failed', error as Error, {
            correlationId,
            endpoint: req.url,
            duration,
        });

        // Track failed request in metrics
        metrics.recordRequest(req.url || '/unknown', false, duration);
        metrics.recordError(error instanceof Error ? error.name : 'UnknownError');

        console.error('[PROXY] Fatal error in proxy handler:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            type: error instanceof Error ? error.constructor.name : typeof error
        });

        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error',
            correlationId,
        });
    } finally {
        // Always track final duration
        const duration = Date.now() - requestStart;
        perfTracker.end({ duration });
    }
}
