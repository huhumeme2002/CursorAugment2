// Session interface for concurrent usage tracking
export interface Session {
    session_id: string;          // Unique session identifier
    device_id: string;           // Device identifier (server-generated)
    ip_address: string;          // Client IP address
    created_at: number;          // Unix timestamp (ms)
    last_activity: number;       // Unix timestamp (ms)
    // Rate limiting fields
    request_count: number;       // Requests in current window
    rate_window_start: number;   // Window start timestamp (ms)
}

// Redis key data schema (Concurrent usage-based with server-generated device IDs)
export interface RedisKeyData {
    expiry: string;
    daily_limit: number;            // Max requests per day
    usage_today: {
        date: string;               // YYYY-MM-DD
        count: number;              // Requests made today
    };
    session_timeout_minutes: number; // Keep for backward compatibility or potential future use
    selected_model?: string;        // Model selected by user (e.g., "gemini", "gpt5")
    selected_api_profile_id?: string; // ID of the specific backend API profile (independent of model)
    last_request_timestamp?: number; // Unix timestamp (ms) of last request - for conversation turn detection
    last_conversation_id?: string;   // Track conversation sessions to prevent duplicate counting
}

// Backup Profile configuration (for Waterfall fallback)
export interface BackupProfile extends APIProfile {
    concurrency_limit: number; // Max concurrent requests before switching to next backup
}

// API Profile configuration (independent backend source)
export interface APIProfile {
    id: string;             // Unique ID (UUID)
    name: string;           // Display name (e.g. "Primary Claude", "Backup GPT-4")
    api_key: string;        // The actual API key for this backend
    api_url: string;        // The endpoint URL
    model_actual?: string;  // The actual model name for this backend (overrides global model_actual)
    model_display?: string; // The display model name for clients (e.g., "claude-opus-4-6")
    capabilities: string[]; // e.g. ["image", "tools"]
    speed: "fast" | "medium" | "slow";
    description?: string;
    is_active: boolean;     // Whether this profile is available for selection
    disable_system_prompt_injection?: boolean; // If true, skip system prompt injection for this profile
    system_prompt_format?: 'auto' | 'anthropic' | 'openai' | 'both' | 'user_message' | 'inject_first_user' | 'disabled'; // How to inject system prompt (default: auto)
}

// Model configuration for per-model system prompts
export interface ModelConfig {
    name: string;           // Display name (e.g., "Gemini 2.0")
    system_prompt: string;  // System prompt for this model
}

// Legacy activation-based schema (for migration compatibility)
export interface LegacyActivationKeyData {
    expiry: string;
    max_activations: number;
    activations: number;
    activated_devices: string[];
}

// OpenAI-compatible request format
export interface OpenAIRequest {
    model: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    [key: string]: any; // Allow additional properties
}

// OpenAI-compatible response format (for non-streaming)
export interface OpenAIResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

// Announcement interface for system-wide notifications
export interface Announcement {
    id: string;                 // Unique ID (UUID)
    title: string;              // Announcement title
    content: string;            // Announcement content (supports HTML)
    type: 'info' | 'warning' | 'error' | 'success'; // Visual style
    priority: number;           // Display priority (higher = shown first)
    is_active: boolean;         // Whether announcement is currently active
    start_time?: string;        // ISO 8601 date string (optional)
    end_time?: string;          // ISO 8601 date string (optional)
    created_at: number;         // Unix timestamp (ms)
    updated_at: number;         // Unix timestamp (ms)
}
