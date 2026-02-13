import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { getKeyData, redis } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
    if (req.method !== 'POST') {
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

        // Get key name from request body (accept both 'name' and 'keyName' for compatibility)
        const { keyName, name } = req.body;
        const actualKeyName = keyName || name;

        if (!actualKeyName || typeof actualKeyName !== 'string') {
            return res.status(400).json({ error: 'Missing keyName in request body' });
        }

        // Get current key data
        const keyData = await getKeyData(actualKeyName);
        if (!keyData) {
            return res.status(404).json({ error: 'Key not found' });
        }

        // Reset usage_today to 0
        const today = new Date().toISOString().split('T')[0];
        keyData.usage_today = {
            date: today,
            count: 0
        };

        // Save updated key data
        await redis.set(actualKeyName, keyData);

        return res.status(200).json({
            success: true,
            message: `Usage quota reset successfully for key "${actualKeyName}"`,
            data: {
                keyName: actualKeyName,
                daily_limit: keyData.daily_limit,
                current_usage: 0,
                usage_date: today
            }
        });
    } catch (error) {
        console.error('Reset quota error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
