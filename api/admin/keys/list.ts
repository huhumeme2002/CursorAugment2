import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { getAllKeys, getKeyData, isExpired } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify JWT token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = verifyToken(token);

        if (!decoded || !decoded.admin) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Get all keys
        const allKeyNames = await getAllKeys();

        // Filter out internal keys (system keys, concurrency counters, backup profiles)
        // User keys should not start with these prefixes
        const keyNames = allKeyNames.filter(name =>
            !name.startsWith('__') &&
            !name.startsWith('concurrency:') &&
            !name.startsWith('backup:') &&
            !name.startsWith('settings')
        );

        // Get detailed info for each key
        const keys = await Promise.all(
            keyNames.map(async (keyName) => {
                const data = await getKeyData(keyName);
                if (!data) return null;

                return {
                    name: keyName,
                    expiry: data.expiry,
                    daily_limit: data.daily_limit,
                    current_usage: data.usage_today.count,
                    usage_date: data.usage_today.date,
                    is_expired: isExpired(data.expiry),
                    is_active: !isExpired(data.expiry) && data.usage_today.count < data.daily_limit,
                    // Backward compatibility (optional)
                    max_activations: data.daily_limit,
                    activations: data.usage_today.count
                };
            })
        );

        // Filter out null values
        const validKeys = keys.filter(k => k !== null);

        // Calculate statistics
        const stats = {
            total_keys: validKeys.length,
            active_keys: validKeys.filter(k => k.is_active).length,
            expired_keys: validKeys.filter(k => k.is_expired).length,
            total_activations: validKeys.reduce((sum, k) => sum + k.activations, 0)
        };

        return res.status(200).json({
            keys: validKeys,
            stats
        });
    } catch (error) {
        console.error('List keys error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
