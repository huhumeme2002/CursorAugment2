import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Agent as HttpsAgent } from 'https';
import { getKeyData, isExpired, getSettings, incrementUsage, checkUsageLimit, getAPIProfile, getBackupProfiles, incrementConcurrency, decrementConcurrency, validateKeyWithUsage } from '../lib/redis';
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
        const clientPath = req.url || '/v1/chat/completions';

        logInfo('Proxy request started', {
            correlationId,
            method: req.method,
            endpoint: clientPath,
            version: PROXY_VERSION,
        });

        // Log client info for debugging
        console.log('[PROXY] Client info:', {
            ip: clientIP,
            userAgent: userAgent.substring(0, 50) + '...'
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

                // DEBUG: Log content structure to understand why object is failing
                console.log('[PROXY] Content structure debug:', {
                    contentType: typeof content,
                    isArray: Array.isArray(content),
                    contentKeys: typeof content === 'object' && content !== null ? Object.keys(content) : 'N/A',
                    hasType: content?.hasOwnProperty('type'),
                    typeValue: content?.type,
                    contentPreview: typeof content === 'string' ? content.substring(0, 100) :
                                  Array.isArray(content) ? `array[${content.length}]` :
                                  typeof content === 'object' ? JSON.stringify(content).substring(0, 200) : 'other',
                    // NEW: Check array items
                    arrayItemTypes: Array.isArray(content) ? content.map((item: any) => item?.type || 'no-type') : 'N/A',
                    firstItemPreview: Array.isArray(content) && content[0] ? JSON.stringify(content[0]).substring(0, 150) : 'N/A'
                });

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

        console.log('[PROXY] Usage counting check:', {
            endpoint: clientPath,
            isCountTokens: isCountTokensEndpoint,
            hasMessages: !!requestBody.messages,
            messageCount: requestBody.messages?.length || 0,
            lastRole: requestBody.messages?.[requestBody.messages?.length - 1]?.role || 'none',
            lastContentType: typeof requestBody.messages?.[requestBody.messages?.length - 1]?.content,
            shouldCountUsage: shouldCountUsage
        });

        // Create conversation ID WITHOUT message hash
        // Claude Opus modifies message content dynamically (adds suggestions, logs, etc.)
        // causing hash-based detection to count same prompt multiple times
        // Solution: Rely on 60s time window + client fingerprint only
        let conversationId = `${clientIP}:${userAgent.substring(0, 50)}`;

        console.log('[PROXY] Conversation ID (time-based):', {
            conversationId: conversationId,
            note: 'Message hash removed due to Claude Opus dynamic content modification'
        });

        // Check current usage (but don't increment yet)
        const currentUsageCheck = await checkUsageLimit(userToken);
        if (!currentUsageCheck.allowed) {
            console.error('[PROXY] BLOCKING REQUEST - Daily limit reached:', {
                userToken: userToken.substring(0, 8) + '...',
                clientIP,
                usage: currentUsageCheck.currentUsage,
                limit: currentUsageCheck.limit
            });
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
            disableSystemPromptInjection?: boolean;
            systemPromptFormat?: 'auto' | 'anthropic' | 'openai' | 'both' | 'user_message' | 'inject_first_user';
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
                    name: `Profile: ${profile.name}`,
                    disableSystemPromptInjection: profile.disable_system_prompt_injection,
                    systemPromptFormat: profile.system_prompt_format
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
                        name: 'Default API',
                        systemPromptFormat: settings?.system_prompt_format
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
        let systemPromptSource = systemPrompt ? 'global' : 'none';

        if (keySelectedModel && settings?.models?.[keySelectedModel]) {
            systemPrompt = settings.models[keySelectedModel].system_prompt;
            systemPromptSource = systemPrompt ? `model:${keySelectedModel}` : systemPromptSource;
        }

        console.log('[PROXY] [SYSPROMPT] Source resolution:', {
            source: systemPromptSource,
            selectedModel: keySelectedModel || '(none)',
            hasGlobalPrompt: !!settings?.system_prompt,
            hasModelPrompt: !!(keySelectedModel && settings?.models?.[keySelectedModel]?.system_prompt),
            availableModelConfigs: settings?.models ? Object.keys(settings.models) : [],
            rawLength: systemPrompt ? String(systemPrompt).length : 0
        });

        // ... (Existing System Prompt Injection Checks) ...
        if (systemPrompt && typeof systemPrompt === 'string') {
            systemPrompt = systemPrompt.trim();
            if (!systemPrompt) {
                console.log('[PROXY] [SYSPROMPT] Prompt was whitespace-only, discarded');
                systemPrompt = undefined;
            } else {
                const MAX_SYSTEM_PROMPT_LENGTH = 10000;
                if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
                    console.log(`[PROXY] [SYSPROMPT] Truncated: ${systemPrompt.length} → ${MAX_SYSTEM_PROMPT_LENGTH} chars`);
                    systemPrompt = systemPrompt.substring(0, MAX_SYSTEM_PROMPT_LENGTH);
                }
            }
        }

        // Check if we should bypass system prompt injection
        const shouldBypassSystemPrompt = activeSource.disableSystemPromptInjection;

        console.log('[PROXY] [SYSPROMPT] Bypass check:', {
            shouldBypass: shouldBypassSystemPrompt,
            reason: shouldBypassSystemPrompt
                ? 'profile.disable_system_prompt_injection=true'
                : 'N/A',
            apiBase,
            profileId: activeSource.id,
            profileName: activeSource.name
        });

        if (shouldBypassSystemPrompt) {
            console.log('[PROXY] [SYSPROMPT] ✅ Bypassed — no injection performed');
        }

        if (systemPrompt && !shouldBypassSystemPrompt) {
            const formatSetting = activeSource.systemPromptFormat || 'auto';
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
                requestBody.system = systemPrompt;
                injectionMethods.push('anthropic:requestBody.system');
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

            console.log('[PROXY] [SYSPROMPT] ✅ Injected:', {
                format: formatSetting,
                methods: injectionMethods,
                source: systemPromptSource,
                promptLength: systemPrompt.length,
                promptPreview: systemPrompt.substring(0, 100) + (systemPrompt.length > 100 ? '...' : ''),
                clientPath,
                autoDetectedAnthropic,
                hadExistingSystemMsg: !!existingSystemInMessages
            });
        } else if (!systemPrompt) {
            console.log('[PROXY] [SYSPROMPT] ⏭️ No system prompt configured — skipping injection');
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
            let usageIncremented = false;
            const safeDecrement = async (reason: string) => {
                if (concurrencyIdToDecrement) {
                    console.log(`[PROXY] Releasing concurrency for ${concurrencyIdToDecrement} (Reason: ${reason})`);
                    const id = concurrencyIdToDecrement;
                    concurrencyIdToDecrement = null; // Prevent double decrement
                    await decrementConcurrency(id);
                }
            };

            // Helper to increment usage once on success
            const safeIncrementUsage = async () => {
                if (shouldCountUsage && !usageIncremented) {
                    usageIncremented = true;
                    const usageResult = await incrementUsage(userToken, conversationId);
                    console.log('[PROXY] Usage incremented after successful response:', {
                        userToken: userToken.substring(0, 8) + '...',
                        usage: usageResult.currentUsage,
                        limit: usageResult.limit,
                        shouldIncrement: usageResult.shouldIncrement,
                        conversationId: conversationId.substring(0, 8) + '...'
                    });
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
            let streamTokenUsage: { input_tokens?: number; output_tokens?: number } = {};

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        // Stream finished successfully
                        clearInterval(heartbeatInterval);
                        await safeDecrement('Stream complete');

                        // Log token usage from stream
                        if (streamTokenUsage.input_tokens || streamTokenUsage.output_tokens) {
                            console.log('[PROXY] Token usage (stream):', {
                                key: userToken.substring(0, 8) + '...',
                                input_tokens: streamTokenUsage.input_tokens || 0,
                                output_tokens: streamTokenUsage.output_tokens || 0,
                                total_tokens: (streamTokenUsage.input_tokens || 0) + (streamTokenUsage.output_tokens || 0),
                                source: activeSource!.name
                            });
                        }

                        // Increment usage after successful stream
                        await safeIncrementUsage();

                        // Track successful streaming request
                        const duration = Date.now() - requestStart;
                        metrics.recordRequest(req.url || '/unknown', true, duration);

                        res.end();
                        break;
                    }

                    let chunk = decoder.decode(value, { stream: true });

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

                    // Rewrite model names in SSE chunks (handles Anthropic and OpenAI formats)
                    if (modelDisplay && modelActual) {
                        chunk = rewriteSSEChunk(chunk, modelActual, modelDisplay);
                    }
                    // Also replace "Claude Code" branding
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

            // Log token usage from non-stream response
            // Anthropic format: data.usage.input_tokens / output_tokens
            // OpenAI format: data.usage.prompt_tokens / completion_tokens
            if (data.usage) {
                const inputTokens = data.usage.input_tokens || data.usage.prompt_tokens || 0;
                const outputTokens = data.usage.output_tokens || data.usage.completion_tokens || 0;
                console.log('[PROXY] Token usage (non-stream):', {
                    key: userToken.substring(0, 8) + '...',
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    total_tokens: inputTokens + outputTokens,
                    source: activeSource!.name
                });
            }

            // Increment usage after successful non-stream response
            if (shouldCountUsage) {
                const usageResult = await incrementUsage(userToken, conversationId);
                console.log('[PROXY] Usage incremented after successful response:', {
                    userToken: userToken.substring(0, 8) + '...',
                    usage: usageResult.currentUsage,
                    limit: usageResult.limit,
                    shouldIncrement: usageResult.shouldIncrement,
                    conversationId: conversationId.substring(0, 8) + '...'
                });
            }

            // Track successful non-streaming request
            const duration = Date.now() - requestStart;
            metrics.recordRequest(req.url || '/unknown', true, duration);

            // Rewrite model names in response body (deep object traversal, case-insensitive)
            const modifiedData = rewriteModelName(data, modelActual, displayModel);

            // Also rewrite response headers if they contain model info
            const responseHeaders: any = {};
            for (const [key, value] of Object.entries(response.headers.raw())) {
                if (typeof value === 'string' && modelActual && modelDisplay) {
                    const regex = new RegExp(modelActual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                    responseHeaders[key] = value.replace(regex, modelDisplay);
                } else {
                    responseHeaders[key] = value;
                }
            }

            // Set rewritten headers
            for (const [key, value] of Object.entries(responseHeaders)) {
                if (key.toLowerCase() !== 'content-length' && key.toLowerCase() !== 'transfer-encoding') {
                    res.setHeader(key, value);
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
