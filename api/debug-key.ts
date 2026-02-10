import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKeyData, isExpired } from '../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const keyName = req.query.key as string;

        if (!keyName) {
            return res.status(400).json({ error: 'Missing key parameter' });
        }

        console.log(`[DEBUG] Checking key: ${keyName}`);

        const data = await getKeyData(keyName);
        if (!data) {
            return res.status(404).json({ error: 'Key not found' });
        }

        const analysis = {
            key_name: keyName,
            schema_type: 'daily_limit',
            expiry: data.expiry,
            is_expired: isExpired(data.expiry),

            // Daily limit fields
            daily_limit: data.daily_limit,
            usage_date: data.usage_today.date,
            usage_count: data.usage_today.count,
            usage_percentage: Math.min(100, Math.round((data.usage_today.count / data.daily_limit) * 100)),

            // Status
            is_at_limit: data.usage_today.count >= data.daily_limit,
            available_requests: Math.max(0, data.daily_limit - data.usage_today.count)
        };

        console.log(`[DEBUG] Key analysis:`, analysis);

        return res.status(200).json(analysis);
    } catch (error) {
        console.error('[DEBUG] Error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}