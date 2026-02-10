import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKeyData, isExpired } from '../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { api_key } = req.body;

        if (!api_key || typeof api_key !== 'string') {
            return res.status(400).json({ error: 'API key is required' });
        }

        const keyData = await getKeyData(api_key);

        if (!keyData) {
            return res.status(404).json({
                error: 'Key not found',
                message: 'API key không tồn tại trong hệ thống'
            });
        }

        const expired = isExpired(keyData.expiry);
        const usagePercent = Math.min(100, Math.round((keyData.usage_today.count / keyData.daily_limit) * 100));

        return res.status(200).json({
            success: true,
            key_name: api_key.substring(0, 8) + '...',
            expiry: keyData.expiry,
            is_expired: expired,
            daily_limit: keyData.daily_limit,
            usage_today: keyData.usage_today.count,
            usage_date: keyData.usage_today.date,
            usage_percent: usagePercent,
            remaining: Math.max(0, keyData.daily_limit - keyData.usage_today.count),
            status: expired ? 'expired' : (usagePercent >= 100 ? 'limit_reached' : 'active')
        });
    } catch (error) {
        console.error('Error in user status:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
