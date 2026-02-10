import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { getSettings } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow GET
    if (req.method !== 'GET') {
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

        // Get settings from Redis
        const settings = await getSettings();

        if (!settings) {
            return res.status(200).json({
                api_url: '',
                api_key: '',
                model_display: 'Claude-Opus-4.5-VIP',
                model_actual: 'claude-3-5-haiku-20241022',
                configured: false
            });
        }

        return res.status(200).json({
            api_url: settings.api_url,
            api_key: settings.api_key ? '********' : '',
            api_key_set: !!settings.api_key,
            model_display: settings.model_display || 'Claude-Opus-4.5-VIP',
            model_actual: settings.model_actual || 'claude-3-5-haiku-20241022',
            system_prompt: settings.system_prompt || '',
            configured: true
        });
    } catch (error) {
        console.error('Error in settings get:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
