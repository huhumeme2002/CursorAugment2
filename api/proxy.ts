import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Agent as HttpsAgent } from 'https';
import { getKeyData, isExpired, getSettings, incrementUsage, getAPIProfile, getBackupProfiles, incrementConcurrency, decrementConcurrency } from '../lib/redis';
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
    maxSockets: 50,           // Max concurrent connections per host (balanced for cluster mode)
    maxFreeSockets: 10,       // Keep 10 idle connections ready
    timeout: 300000,          // Socket timeout: 300s (match server/nginx, prevents kill during long AI thinking)
});

// Default API base URL - match CloudFlare Worker targetBase
const DEFAULT_API_BASE = 'https://code.newcli.com/claude/droid/v1';

// Version marker for deployment verification
const PROXY_VERSION = '3.2.0-monitored';

/**
 * Rewrite model name in response data (case-insensitive, deep object traversal)
 * @param data - Response data (object, string, or array)
 * @param actualModel - The actual model name from upstream (e.g., "gpt-4", "claude-3-5-haiku-20241022")
 * @param displayModel - The display model name for client (e.g., "Claude-Opus-4.5-VIP")
 * @returns Modified data with model names replaced
 */
function rewriteModelName(data: any, actualModel: string, displayModel: string): any {
    if (!actualModel || !displayModel) return data;

    // Handle null/undefined
    if (data === null || data === undefined) return data;

    // Handle string - case-insensitive replacement
    if (typeof data === 'string') {
        // Create case-insensitive regex
        const regex = new RegExp(actualModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        return data.replace(regex, displayModel);
    }

    // Handle array - recursively process each element
    if (Array.isArray(data)) {
        return data.map(item => rewriteModelName(item, actualModel, displayModel));
    }

    // Handle object - recursively process each property
    if (typeof data === 'object') {
        const result: any = {};
        for (const key in data) {
            if (data.hasOwnProperty(key)) {
                result[key] = rewriteModelName(data[key], actualModel, displayModel);
            }
        }
        return result;
    }

    // Handle primitives (number, boolean, etc.)
    return data;
}

/**
 * Rewrite model name in SSE chunk (handles both Anthropic and OpenAI formats)
 * @param chunk - SSE chunk text
 * @param actualModel - The actual model name from upstream
 * @param displayModel - The display model name for client
 * @returns Modified chunk with model names replaced
 */
function rewriteSSEChunk(chunk: string, actualModel: string, displayModel: string): string {
    if (!actualModel || !displayModel) return chunk;

    const lines = chunk.split('\n');
    const modifiedLines: string[] = [];

    for (const line of lines) {
        // Skip empty lines and comments
        if (!line.trim() || line.startsWith(':')) {
            modifiedLines.push(line);
            continue;
        }

        // Process data lines
        if (line.startsWith('data: ')) {
            const dataContent = line.slice(6); // Remove "data: " prefix

            // Skip [DONE] marker
            if (dataContent === '[DONE]') {
                modifiedLines.push(line);
                continue;
            }

            try {
                // Parse JSON and rewrite model names
                const parsed = JSON.parse(dataContent);
                const rewritten = rewriteModelName(parsed, actualModel, displayModel);
                modifiedLines.push('data: ' + JSON.stringify(rewritten));
            } catch (e) {
                // If not valid JSON, do simple text replacement (case-insensitive)
                const regex = new RegExp(actualModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                modifiedLines.push(line.replace(regex, displayModel));
            }
        } else {
            // Other SSE fields (event:, id:, retry:)
            modifiedLines.push(line);
        }
    }

    return modifiedLines.join('\n');
}

/**
 * Build upstream URL matching CloudFlare Worker logic
 * @param apiBase - Base URL (e.g., "https://code.newcli.com/claude/droid" or "https://code.newcli.com/claude/droid/v1")
 * @param clientPath - Path from client request (e.g., "/v1/chat/completions" or "/v1/messages")
 * @returns Final upstream URL
 */
function buildUpstreamUrl(apiBase: string, clientPath: string, clientQuery?: string): string {
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

    // Forward query params from client (e.g. ?beta=true)
    if (clientQuery && clientQuery !== '?') {
        finalUrl += clientQuery;
    }

    return finalUrl;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Setup correlation ID and performance tracking
    const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId();
    setCorrelationId(correlationId);
    res.setHeader('X-Correlation-ID', correlationId);

    // Extract conversation ID for turn-based usage counting
    // Strategy: Use a combination of user-agent + client-ip + message hash as conversation identifier
    // This allows grouping requests from the same prompt within a time window
    const userAgent = req.headers['user-agent'] || 'unknown';
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    const clientIP = forwarded
        ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0])
        : (realIp ? (Array.isArray(realIp) ? realIp[0] : realIp) : 'unknown-ip');

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
        const rawUrl = req.url || '/v1/chat/completions';
        const qIdx = rawUrl.indexOf('?');
        const clientPath = qIdx !== -1 ? rawUrl.slice(0, qIdx) : rawUrl;
        const clientQuery = qIdx !== -1 ? rawUrl.slice(qIdx) : '';

        logInfo('Proxy request started', {
            correlationId,
            method: req.method,
            endpoint: clientPath,
            version: PROXY_VERSION,
        });



        // ====================
        // 1. AUTHENTICATION
        // ====================
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const userToken = authHeader.replace('Bearer ', '');


        const keyData = await getKeyData(userToken);
        if (!keyData) {

            return res.status(401).json({ error: 'Invalid API key' });
        }

        // Per-key debug mode: enable via Redis field debug_mode=true
        const isDebugKey = !!keyData.debug_mode;
        const debugLog = (...args: any[]) => {
            if (isDebugKey) console.log('[DEBUG-KEY]', `[${userToken.substring(0, 8)}]`, ...args);
        };
        if (isDebugKey) {
            console.log('[DEBUG-KEY] ========== DEBUG SESSION START ==========');
            console.log('[DEBUG-KEY] Key:', userToken);
            console.log('[DEBUG-KEY] Client IP:', clientIP);
            console.log('[DEBUG-KEY] Endpoint:', clientPath);
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

        // ====================
        // 3. SMART USAGE COUNTING - DEFERRED
        // ====================
        // Determine if this request should count against quota
        // Usage will be incremented AFTER successful response (not before)

        // Skip count_tokens endpoint (metadata only)
        const isCountTokensEndpoint = clientPath.includes('/count_tokens');

        let shouldCountUsage = false;
        if (!isCountTokensEndpoint && requestBody.messages && Array.isArray(requestBody.messages)) {
            const lastMessage = requestBody.messages[requestBody.messages.length - 1];

            // Check if it's actually a user message (not tool_result)
            // In Anthropic API, tool_result has role=user but content contains type=tool_result
            if (lastMessage?.role === 'user') {
                const content = lastMessage.content;



                // Check if content is a tool_result
                // Content can be string (actual user message) or array of content blocks
                if (typeof content === 'string') {
                    // Simple string content = real user message
                    shouldCountUsage = true;
                } else if (Array.isArray(content)) {
                    // Check if any block is a tool_result
                    const hasToolResult = content.some(
                        (block: any) => block.type === 'tool_result'
                    );
                    // Only count if there's NO tool_result in content
                    shouldCountUsage = !hasToolResult;
                } else {
                    // Single object content - check type
                    // If content is an object without 'type' property, it's likely a user message
                    const isToolResult = content && typeof content === 'object' && content.type === 'tool_result';
                    shouldCountUsage = !isToolResult;
                }
            }
        }

        // Create conversation ID WITHOUT message hash
        // Claude Opus modifies message content dynamically (adds suggestions, logs, etc.)
        // causing hash-based detection to count same prompt multiple times
        // Solution: Rely on 60s time window + client fingerprint only
        let conversationId = `${clientIP}:${userAgent.substring(0, 50)}`;

        // Inline usage check — keyData already has usage_today from getKeyData() above
        // Avoids a duplicate Redis GET that checkUsageLimit() would make (~20ms saved)
        const currentUsageCheck = {
            allowed: keyData.usage_today.count < keyData.daily_limit,
            currentUsage: keyData.usage_today.count,
            limit: keyData.daily_limit,
        };
        if (!currentUsageCheck.allowed) {
            return res.status(429).json({
                error: 'Daily limit reached',
                message: `This key has reached its daily limit of ${currentUsageCheck.limit} requests. Please try again tomorrow.`,
                current_usage: currentUsageCheck.currentUsage,
                daily_limit: currentUsageCheck.limit
            });
        }

        // ====================
        // 4. LOAD SETTINGS & WATERFALL PREPARATION
        // ====================
        const settings = await getSettings();
        const defaultApiBase = settings?.api_url || DEFAULT_API_BASE;
        const defaultApiKey = settings?.api_key || process.env.API_KEY_GOC;
        const defaultConcurrencyLimit = settings?.concurrency_limit || 100; // Default to 100 if not set



        // Determine if we are using a specific User Profile (overrides waterfall)
        let userSelectedProfileId = keyData.selected_api_profile_id;
        let activeSource: {
            id: string;
            type: 'default' | 'profile' | 'backup';
            apiBase: string;
            apiKey: string;
            modelActual?: string;
            modelDisplay?: string;
            name: string;
            disableSystemPromptInjection?: boolean;
            systemPromptFormat?: 'auto' | 'anthropic' | 'openai' | 'both' | 'user_message' | 'inject_first_user' | 'disabled';
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
                    modelDisplay: profile.model_display,
                    name: `Profile: ${profile.name}`,
                    disableSystemPromptInjection: profile.disable_system_prompt_injection,
                    systemPromptFormat: profile.system_prompt_format
                };

            } else {

                // Fall through to Strategy B
            }
        }

        if (!activeSource) {
            // STRATEGY B: Waterfall (Default -> Backup 1 -> Backup 2)

            // 1. Try Default Source
            if (defaultApiKey) {
                const numericLimit = Number(defaultConcurrencyLimit) || 100;
                const check = await incrementConcurrency('default', numericLimit);


                if (check.allowed) {
                    activeSource = {
                        id: 'default',
                        type: 'default',
                        apiBase: defaultApiBase,
                        apiKey: defaultApiKey,
                        modelActual: settings?.model_actual,
                        name: 'Default API',
                        systemPromptFormat: settings?.system_prompt_format
                    };
                    concurrencyIdToDecrement = 'default';

                } else {

                }
            }

            // 2. Try Backups if Default failed or wasn't configured
            if (!activeSource) {
                const backups = await getBackupProfiles();


                for (const backup of backups) {
                    if (!backup.is_active) {
                        continue;
                    }

                    const limit = Number(backup.concurrency_limit) || 10;
                    const check = await incrementConcurrency(backup.id, limit);


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

                        break; // Found a source, stop looking
                    } else {

                    }
                }
            }

            // 3. Fallback to Default API even if at capacity (allow queueing)
            if (!activeSource && defaultApiKey) {

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

        const apiUrl = buildUpstreamUrl(apiBase, clientPath, clientQuery);


        // ====================
        // 6. MODEL VALIDATION & TRANSFORMATION
        // ====================

        // Transform model name (prioritize profile-specific, then global settings)
        const modelDisplay = activeSource.modelDisplay || settings?.model_display || 'Claude-Opus-4.5-VIP';
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


        // ====================
        // 7. SYSTEM PROMPT INJECTION
        // ====================
        // ... (Existing System Prompt Logic - reusing settings) ...
        // Note: activeSource is setup, but system prompt logic relies on 'settings'
        // If we want backup profiles to have their own system prompts, we'd need to extend that.
        // For now, retaining Global/Model-specific system prompt logic from settings.

        let systemPrompt = settings?.system_prompt;
        const keySelectedModel = keyData.selected_model;
        let systemPromptSource = systemPrompt ? 'global' : 'none';

        if (keySelectedModel && settings?.models?.[keySelectedModel]) {
            systemPrompt = settings.models[keySelectedModel].system_prompt;
            systemPromptSource = systemPrompt ? `model:${keySelectedModel}` : systemPromptSource;
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

        // Check if we should bypass system prompt injection
        const shouldBypassSystemPrompt = activeSource.disableSystemPromptInjection;



        if (systemPrompt && !shouldBypassSystemPrompt) {
            const formatSetting = activeSource.systemPromptFormat || 'auto';

            if (formatSetting === 'disabled') {

            } else {
                const autoDetectedAnthropic = 'system' in requestBody || clientPath.includes('/messages');
                const existingSystemInMessages = requestBody.messages?.some?.((msg: any) => msg.role === 'system');

                // Determine which formats to use based on profile setting
                let useAnthropic = false;
                let useOpenAI = false;
                let useUserMessage = false;
                let useInjectFirstUser = false;

                if (formatSetting === 'anthropic') {
                    useAnthropic = true;
                } else if (formatSetting === 'openai') {
                    useOpenAI = true;
                } else if (formatSetting === 'both') {
                    useAnthropic = true;
                    useOpenAI = true;
                } else if (formatSetting === 'user_message') {
                    useUserMessage = true;
                } else if (formatSetting === 'inject_first_user') {
                    useInjectFirstUser = true;
                } else {
                    // auto: use existing detection logic
                    if (autoDetectedAnthropic) {
                        useAnthropic = true;
                    } else {
                        useOpenAI = true;
                    }
                }

                let injectionMethods: string[] = [];

                if (useAnthropic) {
                    // If existing system is already an array, append our prompt as a text block
                    // Otherwise set as array format (required by some upstreams like supperapi.store)
                    if (Array.isArray(requestBody.system)) {
                        requestBody.system = [...requestBody.system, { type: 'text', text: systemPrompt }];
                        injectionMethods.push('anthropic:requestBody.system_array_appended');
                    } else {
                        requestBody.system = [{ type: 'text', text: systemPrompt }];
                        injectionMethods.push('anthropic:requestBody.system_array');
                    }
                }

                if (useOpenAI && requestBody.messages && Array.isArray(requestBody.messages)) {
                    if (existingSystemInMessages) {
                        requestBody.messages = requestBody.messages.map((msg: any) => msg.role === 'system' ? { role: 'system', content: systemPrompt } : msg);
                        injectionMethods.push('openai:replaced_existing_system_message');
                    } else {
                        requestBody.messages.unshift({ role: 'system', content: systemPrompt });
                        injectionMethods.push('openai:prepended_new_system_message');
                    }
                } else if (useOpenAI) {
                    injectionMethods.push('openai:skipped_no_messages_array');
                }

                if (useUserMessage && requestBody.messages && Array.isArray(requestBody.messages)) {
                    // Remove existing system messages to avoid conflicts
                    if (existingSystemInMessages) {
                        requestBody.messages = requestBody.messages.filter((msg: any) => msg.role !== 'system');
                        injectionMethods.push('user_message:removed_existing_system_messages');
                    }
                    // Remove top-level system field if present
                    if ('system' in requestBody) {
                        delete requestBody.system;
                    }
                    const wrappedContent = `[System Instructions]\n${systemPrompt}\n[End System Instructions]`;
                    requestBody.messages.unshift({ role: 'user', content: wrappedContent });
                    injectionMethods.push('user_message:prepended_as_user_role');
                } else if (useUserMessage) {
                    injectionMethods.push('user_message:skipped_no_messages_array');
                }

                if (useInjectFirstUser && requestBody.messages && Array.isArray(requestBody.messages)) {
                    // Remove top-level system field and any system messages
                    if ('system' in requestBody) delete requestBody.system;
                    if (existingSystemInMessages) {
                        requestBody.messages = requestBody.messages.filter((msg: any) => msg.role !== 'system');
                    }
                    // Find first user message and prepend system prompt to its content
                    const firstUserIdx = requestBody.messages.findIndex((msg: any) => msg.role === 'user');
                    if (firstUserIdx !== -1) {
                        const firstMsg = requestBody.messages[firstUserIdx];
                        const prefix = `[System Instructions]\n${systemPrompt}\n[End System Instructions]\n\n`;
                        if (Array.isArray(firstMsg.content)) {
                            // Anthropic format: content is array of blocks — prepend as a text block
                            requestBody.messages[firstUserIdx] = {
                                ...firstMsg,
                                content: [{ type: 'text', text: prefix }, ...firstMsg.content]
                            };
                            injectionMethods.push('inject_first_user:prepended_text_block_to_array');
                        } else {
                            requestBody.messages[firstUserIdx] = {
                                ...firstMsg,
                                content: `${prefix}${firstMsg.content ?? ''}`
                            };
                            injectionMethods.push('inject_first_user:merged_into_first_user_message');
                        }
                    } else {
                        injectionMethods.push('inject_first_user:skipped_no_user_message_found');
                    }
                } else if (useInjectFirstUser) {
                    injectionMethods.push('inject_first_user:skipped_no_messages_array');
                }

                if (injectionMethods.length === 0) {
                    injectionMethods.push('none:no_target');
                }


            } // end else (formatSetting !== 'disabled')
        } else if (!systemPrompt) {

        }


        // ====================
        // 8. EXECUTE REQUEST
        // ====================


        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

        let response: Response | undefined;

        const fetchHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'text/event-stream',
            'Accept-Encoding': 'identity',
            'Connection': 'keep-alive',
            'x-api-key': apiKey,
            // Forward Anthropic/client headers if present
            ...(req.headers['anthropic-version'] && { 'anthropic-version': req.headers['anthropic-version'] as string }),
            ...(req.headers['anthropic-beta'] && { 'anthropic-beta': req.headers['anthropic-beta'] as string }),
            ...(req.headers['user-agent'] && { 'User-Agent': req.headers['user-agent'] as string }),
            ...(req.headers['x-app'] && { 'x-app': req.headers['x-app'] as string }),
            ...(req.headers['x-stainless-lang'] && { 'x-stainless-lang': req.headers['x-stainless-lang'] as string }),
            ...(req.headers['x-stainless-os'] && { 'x-stainless-os': req.headers['x-stainless-os'] as string }),
            ...(req.headers['x-stainless-arch'] && { 'x-stainless-arch': req.headers['x-stainless-arch'] as string }),
            ...(req.headers['x-stainless-runtime'] && { 'x-stainless-runtime': req.headers['x-stainless-runtime'] as string }),
            ...(req.headers['x-stainless-runtime-version'] && { 'x-stainless-runtime-version': req.headers['x-stainless-runtime-version'] as string }),
            ...(req.headers['x-stainless-package-version'] && { 'x-stainless-package-version': req.headers['x-stainless-package-version'] as string }),
            ...(req.headers['anthropic-dangerous-direct-browser-access'] && { 'anthropic-dangerous-direct-browser-access': req.headers['anthropic-dangerous-direct-browser-access'] as string }),
        };

        const fetchBody = JSON.stringify(requestBody);
        const MAX_FETCH_RETRIES = 3;
        const MAX_TRAFFIC_RETRIES = 15; // Keep retrying "Traffic high" for up to ~30 seconds
        const TRAFFIC_RETRY_DELAY_MS = 2000; // 2s between traffic retries
        const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);

        let generalAttempt = 0;
        let trafficRetryCount = 0;
        let lastErrorBody: string | null = null;

        retryLoop: while (true) {
            generalAttempt++;
            try {
                response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: fetchHeaders,
                    body: fetchBody,
                    signal: controller.signal,
                    // @ts-ignore - Node.js fetch supports agent option
                    agent: httpsAgent,
                });

                // Check for retryable HTTP status codes (5xx from upstream)
                if (RETRYABLE_STATUS_CODES.has(response.status)) {
                    lastErrorBody = await response.text();

                    // Special handling: "Traffic is currently high" - keep retrying until it clears
                    const isTrafficError = /traffic is\s+currently high|rate limits for standard plans/i.test(lastErrorBody);

                    if (isTrafficError && trafficRetryCount < MAX_TRAFFIC_RETRIES) {
                        trafficRetryCount++;
                        if (trafficRetryCount === 1 || trafficRetryCount % 10 === 0) {
                            // Log first attempt and every 10th to avoid log spam
                            console.warn(`[PROXY] ⏳ Traffic high (retry ${trafficRetryCount}/${MAX_TRAFFIC_RETRIES}), waiting ${TRAFFIC_RETRY_DELAY_MS}ms...`, {
                                url: apiUrl,
                                source: activeSource!.name
                            });
                        }
                        await new Promise(resolve => setTimeout(resolve, TRAFFIC_RETRY_DELAY_MS));
                        generalAttempt--; // Don't count traffic retries against general retry budget
                        continue retryLoop;
                    }

                    if (isTrafficError && trafficRetryCount >= MAX_TRAFFIC_RETRIES) {
                        console.error(`[PROXY] ❌ Traffic still high after ${trafficRetryCount} retries (~${trafficRetryCount * TRAFFIC_RETRY_DELAY_MS / 1000}s), giving up`);
                        break;
                    }

                    // General 5xx retry (non-traffic errors)
                    if (generalAttempt < MAX_FETCH_RETRIES) {
                        const backoffMs = generalAttempt * 2000; // 2s, 4s
                        console.warn(`[PROXY] Upstream returned ${response.status} on attempt ${generalAttempt}/${MAX_FETCH_RETRIES}, retrying in ${backoffMs}ms...`, {
                            url: apiUrl,
                            source: activeSource!.name,
                            errorPreview: lastErrorBody.substring(0, 200)
                        });
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                        continue retryLoop;
                    }
                }

                break; // Success or non-retryable status or exhausted retries
            } catch (fetchError) {
                const isRetryableNetworkError = fetchError instanceof Error && (
                    fetchError.message.includes('ZlibError') ||
                    fetchError.message.includes('Zlib') ||
                    fetchError.message.includes('incorrect header check') ||
                    fetchError.message.includes('unexpected end of file') ||
                    fetchError.message.includes('invalid stored block lengths') ||
                    fetchError.name === 'ZlibError' ||
                    fetchError.message.includes('ECONNRESET') ||
                    fetchError.message.includes('ECONNREFUSED') ||
                    fetchError.message.includes('ETIMEDOUT') ||
                    fetchError.message.includes('UND_ERR_CONNECT_TIMEOUT')
                );

                if (isRetryableNetworkError && generalAttempt < MAX_FETCH_RETRIES) {
                    const backoffMs = generalAttempt * 2000;
                    console.warn(`[PROXY] Network error on attempt ${generalAttempt}/${MAX_FETCH_RETRIES}, retrying in ${backoffMs}ms...`, {
                        error: (fetchError as Error).message,
                        url: apiUrl
                    });
                    // Force no compression on retry (helps with ZlibError)
                    fetchHeaders['Accept-Encoding'] = 'identity';
                    await new Promise(resolve => setTimeout(resolve, backoffMs));
                    continue retryLoop;
                }

                clearTimeout(timeoutId);
                if (concurrencyIdToDecrement) await decrementConcurrency(concurrencyIdToDecrement);

                console.error('[PROXY] Fetch error (all retries exhausted):', fetchError);
                if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                    return res.status(504).json({ error: 'Request timeout' });
                }
                throw fetchError;
            }
        }

        // Log traffic retry summary if any occurred
        if (trafficRetryCount > 0) {
            console.log(`[PROXY] ✅ Traffic retry summary: ${trafficRetryCount} retries, ${response?.ok ? 'succeeded' : 'failed'}`);
        }
        clearTimeout(timeoutId);

        // Safety check - should never happen as fetch errors are thrown above
        if (!response) {
            if (concurrencyIdToDecrement) await decrementConcurrency(concurrencyIdToDecrement);
            return res.status(502).json({ error: 'Failed to get response from upstream after retries' });
        }

        if (!response.ok) {
            // Decrement immediately on error
            if (concurrencyIdToDecrement) await decrementConcurrency(concurrencyIdToDecrement);

            let errorText = lastErrorBody || await response.text();
            console.error('[PROXY] Upstream error (after all retries):', {
                status: response.status,
                generalAttempts: generalAttempt,
                trafficRetries: trafficRetryCount,
                source: activeSource!.name,
                error: errorText.substring(0, 500)
            });

            // =====================
            // SANITIZE UPSTREAM ERROR - Prevent MiniMax identity leakage
            // =====================
            // Check for known MiniMax-specific error patterns and replace with Anthropic-style errors
            const errorTextLower = errorText.toLowerCase();
            
            // Pattern matching for MiniMax-specific error messages
            const minimaxErrorPatterns: Array<{ pattern: RegExp; status: number; response: any }> = [
                {
                    // "Traffic is currently high. Rate limits for standard plans may be temporarily reduced."
                    pattern: /traffic is\s+currently high|rate limits for standard plans/i,
                    status: 429,
                    response: {
                        type: 'error',
                        error: {
                            type: 'rate_limit_error',
                            message: 'Your API request was rate limited. Please retry after a brief wait.'
                        }
                    }
                },
                {
                    // "Rate limit exceeded" or similar
                    pattern: /rate limit exceeded|too many requests|request rate too high/i,
                    status: 429,
                    response: {
                        type: 'error',
                        error: {
                            type: 'rate_limit_error',
                            message: 'Number of request tokens has exceeded your per-minute rate limit. Please retry after a brief wait.'
                        }
                    }
                },
                {
                    // "Service overloaded" / "Server overloaded"
                    pattern: /overloaded|service unavailable|temporarily unavailable|server is busy/i,
                    status: 529,
                    response: {
                        type: 'error',
                        error: {
                            type: 'overloaded_error',
                            message: 'Anthropic\'s API is temporarily overloaded. Please try again later.'
                        }
                    }
                },
                {
                    // "Insufficient balance" / "quota exceeded"
                    pattern: /insufficient balance|quota exceeded|billing|payment required|credit/i,
                    status: 529,
                    response: {
                        type: 'error',
                        error: {
                            type: 'overloaded_error',
                            message: 'Anthropic\'s API is temporarily overloaded. Please try again later.'
                        }
                    }
                },
                {
                    // "Invalid API key" from MiniMax - mask as overloaded to not expose internals
                    pattern: /invalid api[_\s-]?key|authentication failed|unauthorized/i,
                    status: 529,
                    response: {
                        type: 'error',
                        error: {
                            type: 'overloaded_error',
                            message: 'Anthropic\'s API is temporarily overloaded. Please try again later.'
                        }
                    }
                },
                {
                    // "Content policy" or moderation errors from MiniMax
                    pattern: /content policy|moderation|sensitive content|input_sensitive|output_sensitive/i,
                    status: 400,
                    response: {
                        type: 'error',
                        error: {
                            type: 'invalid_request_error',
                            message: 'Your request was flagged by our content filtering system. Please modify your prompt and try again.'
                        }
                    }
                },
                {
                    // "High-Speed plan" or "upgrade" mentions (MiniMax-specific upsell)
                    pattern: /high-speed plan|upgrade to|priority capacity|standard plans/i,
                    status: 429,
                    response: {
                        type: 'error',
                        error: {
                            type: 'rate_limit_error',
                            message: 'Your API request was rate limited. Please retry after a brief wait.'
                        }
                    }
                }
            ];

            // Try to match known MiniMax error patterns
            for (const { pattern, status, response: errorResponse } of minimaxErrorPatterns) {
                if (pattern.test(errorText)) {
                    console.log('[PROXY] Sanitized MiniMax error:', {
                        originalPattern: pattern.source,
                        mappedType: errorResponse.error.type,
                        originalStatus: response.status,
                        mappedStatus: status
                    });
                    return res.status(status).json(errorResponse);
                }
            }

            // Fallback: sanitize text but still mask any MiniMax references
            errorText = errorText.replace(/MiniMax-M2\.5-highspeed/gi, modelDisplay || 'claude-opus-4-6');
            errorText = errorText.replace(/MiniMax-M2\.5/gi, modelDisplay || 'claude-opus-4-6');
            errorText = errorText.replace(/MiniMax/gi, 'Claude');
            errorText = errorText.replace(/minimax/gi, 'claude');
            // Also mask any "High-Speed plan" or "standard plans" references in fallback
            errorText = errorText.replace(/High-Speed plan/gi, '');
            errorText = errorText.replace(/standard plans?/gi, '');
            errorText = errorText.replace(/upgrade to the.*?for priority capacity/gi, '');

            // Return as Anthropic-style error format
            return res.status(response.status).json({
                type: 'error',
                error: {
                    type: 'api_error',
                    message: errorText.substring(0, 500) // Limit error text length
                }
            });
        }

        // ====================
        // 9. HANDLE RESPONSE (Stream or JSON)
        // ====================

        if (requestBody.stream) {
            // ... (Stream logic) ...

            debugLog('Stream mode: true, upstream status:', response.status);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Send initial connection confirmation to prevent immediate timeout
            res.write(':connected\n\n');

            // Helper to ensure we only decrement once
            let usageIncremented = false;
            const safeDecrement = async (reason: string) => {
                if (concurrencyIdToDecrement) {

                    const id = concurrencyIdToDecrement;
                    concurrencyIdToDecrement = null; // Prevent double decrement
                    await decrementConcurrency(id);
                }
            };

            // Helper to increment usage once on success
            const safeIncrementUsage = async () => {
                if (shouldCountUsage && !usageIncremented) {
                    usageIncremented = true;
                    await incrementUsage(userToken, conversationId);
                }
            };

            // Setup heartbeat to prevent nginx timeout during long thinking periods
            // SSE comments (lines starting with :) are ignored by clients
            const heartbeatInterval = setInterval(() => {
                if (!res.writableEnded) {
                    try {
                        res.write(':heartbeat\n\n');

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
            let streamTokenUsage: { input_tokens?: number; output_tokens?: number } = {};
            let streamChunkCount = 0;
            let streamTotalBytes = 0;
            const streamStartTime = Date.now();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        // Stream finished successfully
                        clearInterval(heartbeatInterval);
                        await safeDecrement('Stream complete');
                        debugLog('✅ Stream complete:', { chunks: streamChunkCount, totalBytes: streamTotalBytes, durationMs: Date.now() - streamStartTime });

                        // Log token usage from stream


                        // Increment usage after successful stream
                        await safeIncrementUsage();

                        // Track successful streaming request
                        const duration = Date.now() - requestStart;
                        metrics.recordRequest(req.url || '/unknown', true, duration);

                        res.end();
                        break;
                    }

                    let chunk = decoder.decode(value, { stream: true });
                    streamChunkCount++;
                    streamTotalBytes += chunk.length;

                    // Per-key debug: log every chunk with timing
                    if (isDebugKey) {
                        const elapsed = Date.now() - streamStartTime;
                        debugLog(`Chunk #${streamChunkCount} | +${elapsed}ms | ${chunk.length} bytes | total: ${streamTotalBytes} bytes`);
                        // Log SSE event types in this chunk
                        const eventTypes = chunk.match(/"type":"([^"]+)"/g);
                        if (eventTypes) debugLog('  Events:', eventTypes.join(', '));
                        // Log stop_reason if present (critical for debugging cutoffs)
                        const stopMatch = chunk.match(/"stop_reason":"?([^"\},]+)"?/);
                        if (stopMatch) debugLog('  ⚠️ stop_reason:', stopMatch[1]);
                    }

                    // Extract token usage from SSE stream events                    // Extract token usage from SSE stream events
                    // Anthropic: message_delta with usage, or message_start with usage
                    // OpenAI: final chunk with usage field
                    try {
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                            const jsonStr = line.slice(6);
                            const parsed = JSON.parse(jsonStr);

                            // Anthropic format: message_start has input_tokens, message_delta has output_tokens
                            if (parsed.type === 'message_start' && parsed.message?.usage) {
                                streamTokenUsage.input_tokens = parsed.message.usage.input_tokens;
                            }
                            if (parsed.type === 'message_delta' && parsed.usage) {
                                streamTokenUsage.output_tokens = parsed.usage.output_tokens;
                            }

                            // OpenAI format: usage in final chunk
                            if (parsed.usage) {
                                if (parsed.usage.prompt_tokens) streamTokenUsage.input_tokens = parsed.usage.prompt_tokens;
                                if (parsed.usage.completion_tokens) streamTokenUsage.output_tokens = parsed.usage.completion_tokens;
                            }
                        }
                    } catch (_) {
                        // Ignore parse errors - not all chunks contain JSON
                    }

                    // =====================
                    // DEBUG: Log raw chunk BEFORE rewrite (only for tool_call related chunks)
                    // =====================


                    // Rewrite model names in SSE chunks (handles Anthropic and OpenAI formats)
                    if (modelDisplay && modelActual) {
                        chunk = rewriteSSEChunk(chunk, modelActual, modelDisplay);
                    }
                    // Rewrite identity strings to match display model name
                    chunk = chunk.replace(/Claude Code/g, 'Claude Opus');
                    chunk = chunk.replace(/Claude Sonnet 4\.5/g, 'Claude Opus 4.6');
                    chunk = chunk.replace(/Claude Sonnet 4\.6/g, 'Claude Opus 4.6');
                    chunk = chunk.replace(/Claude Haiku 4\.5/g, 'Claude Opus 4.6');
                    chunk = chunk.replace(/claude-sonnet-4-5/g, 'claude-opus-4-6');
                    chunk = chunk.replace(/claude-sonnet-4-6/g, 'claude-opus-4-6');
                    chunk = chunk.replace(/claude-haiku-4-5/g, 'claude-opus-4-6');
                    chunk = chunk.replace(/Sonnet 4\.5/g, 'Opus 4.6');
                    chunk = chunk.replace(/Sonnet 4\.6/g, 'Opus 4.6');

                    // =====================
                    // MINIMAX IDENTITY MASKING
                    // =====================
                    // 1. Rewrite SSE event types: "event: minimax:tool_call" → "event: content_block_start"
                    chunk = chunk.replace(/^event:\s*minimax:tool_call/gm, 'event: content_block_start');
                    chunk = chunk.replace(/^event:\s*minimax:[a-z_]+/gm, 'event: content_block_delta');

                    // 3. Rewrite any "MiniMax" / "minimax" text references in content
                    chunk = chunk.replace(/MiniMax-M2\.5-highspeed/gi, modelDisplay || 'claude-opus-4-6');
                    chunk = chunk.replace(/MiniMax-M2\.5/gi, modelDisplay || 'claude-opus-4-6');
                    chunk = chunk.replace(/MiniMax/gi, 'Claude');
                    chunk = chunk.replace(/minimax/gi, 'claude');

                    // 4. Strip MiniMax-specific fields that don't exist in Anthropic/OpenAI APIs
                    //    These fields are fingerprints that reveal upstream is MiniMax
                    chunk = chunk.replace(/,?"audio_content":"[^"]*"/g, '');
                    chunk = chunk.replace(/,?"input_sensitive":(true|false)/g, '');
                    chunk = chunk.replace(/,?"output_sensitive":(true|false)/g, '');
                    chunk = chunk.replace(/,?"input_sensitive_type":\d+/g, '');
                    chunk = chunk.replace(/,?"output_sensitive_type":\d+/g, '');
                    chunk = chunk.replace(/,?"output_sensitive_int":\d+/g, '');



                    res.write(chunk);
                }
            } catch (streamError) {
                const isZlibError = streamError instanceof Error && (
                    streamError.message.includes('ZlibError') ||
                    streamError.message.includes('Zlib') ||
                    streamError.message.includes('incorrect header check') ||
                    streamError.message.includes('unexpected end of file') ||
                    streamError.name === 'ZlibError'
                );

                if (isZlibError) {
                    console.error('[PROXY] ZlibError during stream read - upstream sent corrupted compressed data:', {
                        error: (streamError as Error).message,
                        url: apiUrl,
                        hint: 'Upstream server may be sending gzip-encoded data despite Accept-Encoding: identity'
                    });
                } else {
                    console.error('[PROXY] Stream error:', streamError);
                }
                debugLog('❌ Stream error after', streamChunkCount, 'chunks,', streamTotalBytes, 'bytes,', Date.now() - streamStartTime, 'ms:', (streamError as Error).message);
                clearInterval(heartbeatInterval);
                await safeDecrement('Stream error');
                res.end();
            }

        } else {
            // Non-stream
            const data = await response.json() as any;
            // Decrement immediately after getting full response
            if (concurrencyIdToDecrement) await decrementConcurrency(concurrencyIdToDecrement);

            // Log token usage from non-stream response
            // Anthropic format: data.usage.input_tokens / output_tokens
            // OpenAI format: data.usage.prompt_tokens / completion_tokens
            if (data.usage) {
                const inputTokens = data.usage.input_tokens || data.usage.prompt_tokens || 0;
                const outputTokens = data.usage.output_tokens || data.usage.completion_tokens || 0;
            }

            // Increment usage after successful non-stream response
            if (shouldCountUsage) {
                await incrementUsage(userToken, conversationId);
            }

            // Track successful non-streaming request
            const duration = Date.now() - requestStart;
            metrics.recordRequest(req.url || '/unknown', true, duration);

            // Rewrite model names in response body (deep object traversal, case-insensitive)
            let modifiedData = rewriteModelName(data, modelActual, modelDisplay);

            // Minimax identity masking for non-stream responses
            let jsonStr = JSON.stringify(modifiedData);
            jsonStr = jsonStr.replace(/MiniMax-M2\.5-highspeed/gi, modelDisplay || 'claude-opus-4-6');
            jsonStr = jsonStr.replace(/MiniMax-M2\.5/gi, modelDisplay || 'claude-opus-4-6');
            jsonStr = jsonStr.replace(/MiniMax/gi, 'Claude');
            jsonStr = jsonStr.replace(/minimax/gi, 'claude');
            // Strip MiniMax-specific fields
            jsonStr = jsonStr.replace(/,?"audio_content":"[^"]*"/g, '');
            jsonStr = jsonStr.replace(/,?"input_sensitive":(true|false)/g, '');
            jsonStr = jsonStr.replace(/,?"output_sensitive":(true|false)/g, '');
            jsonStr = jsonStr.replace(/,?"input_sensitive_type":\d+/g, '');
            jsonStr = jsonStr.replace(/,?"output_sensitive_type":\d+/g, '');
            jsonStr = jsonStr.replace(/,?"output_sensitive_int":\d+/g, '');
            modifiedData = JSON.parse(jsonStr);

            // Also rewrite response headers if they contain model info
            const responseHeaders: any = {};
            const rawHeaders: Record<string, string | string[]> = {};
            response.headers.forEach((value: string | string[], key: string) => {
                rawHeaders[key] = value;
            });
            for (const [key, value] of Object.entries(rawHeaders)) {
                if (typeof value === 'string' && modelActual && modelDisplay) {
                    const regex = new RegExp(modelActual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                    responseHeaders[key] = value.replace(regex, modelDisplay);
                } else {
                    responseHeaders[key] = value;
                }
            }

            // Set rewritten headers
            // IMPORTANT: Skip content-encoding because response.json() already decompresses the body.
            // Forwarding Content-Encoding: gzip with a decompressed body causes ZlibError on the client.
            // Also skip content-length (body may have changed size) and transfer-encoding.
            // Skip headers that could leak upstream identity or cause encoding issues
            const SKIP_HEADERS = new Set([
                'content-length', 'transfer-encoding', 'content-encoding',
                'server', 'x-powered-by', 'via',           // Upstream server identity
                'x-request-id', 'x-trace-id',               // Upstream tracing IDs
                'x-minimax-request-id',                      // MiniMax-specific headers
            ]);
            for (const [key, value] of Object.entries(responseHeaders)) {
                if (!SKIP_HEADERS.has(key.toLowerCase())) {
                    res.setHeader(key, value as string | string[]);
                }
            }

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
