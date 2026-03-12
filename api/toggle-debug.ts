import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKeyData, redis } from '../lib/redis';

/**
 * Toggle debug mode for a specific API key
 * Usage: POST /api/toggle-debug?key=YOUR_KEY&enable=true|false
 * Or: GET /api/toggle-debug?key=YOUR_KEY (shows current status)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        const keyName = (req.query.key || req.body?.key) as string;

        if (!keyName) {
            return res.status(400).json({ error: 'Missing key parameter' });
        }

        const data = await getKeyData(keyName);
        if (!data) {
            return res.status(404).json({ error: 'Key not found' });
        }

        if (req.method === 'GET') {
            return res.status(200).json({
                key: keyName.substring(0, 8) + '...',
                debug_mode: !!data.debug_mode
            });
        }

        if (req.method === 'POST') {
            const enable = req.query.enable === 'true' || req.body?.enable === true;
            data.debug_mode = enable;
            await redis.set(keyName, data);

            console.log(`[DEBUG] Debug mode ${enable ? 'ENABLED' : 'DISABLED'} for key: ${keyName}`);

            return res.status(200).json({
                key: keyName.substring(0, 8) + '...',
                debug_mode: enable,
                message: `Debug mode ${enable ? 'enabled' : 'disabled'}. Check PM2 logs with: pm2 logs | grep DEBUG-KEY`
            });
        }

        return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    } catch (error) {
        console.error('[DEBUG] Toggle error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
