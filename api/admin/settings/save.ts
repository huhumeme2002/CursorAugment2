import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { saveSettings, clearSettingsCache } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify JWT token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing authorization header' });
        }

        const token = authHeader.replace('Bearer ', '');
        const verified = verifyToken(token);
        if (!verified) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Parse body
        const { api_url, api_key, model_display, model_actual, system_prompt, concurrency_limit, system_prompt_format } = req.body;

        if (!api_url || !api_key) {
            return res.status(400).json({ error: 'api_url and api_key are required' });
        }

        // Save settings to Redis (including optional model mapping and system prompt)
        const success = await saveSettings(api_url, api_key, model_display, model_actual, system_prompt, concurrency_limit, system_prompt_format);

        if (!success) {
            return res.status(500).json({ error: 'Failed to save settings' });
        }

        // Clear settings cache to force reload on next request
        clearSettingsCache();
        console.log('[ADMIN] Settings saved and cache cleared');

        return res.status(200).json({
            success: true,
            message: 'Settings saved successfully'
        });
    } catch (error) {
        console.error('Error in settings save:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
