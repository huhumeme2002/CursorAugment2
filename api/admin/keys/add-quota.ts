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

        // Get key name and amount from request body
        const { keyName, amount } = req.body;

        if (!keyName || typeof keyName !== 'string') {
            return res.status(400).json({ error: 'Missing keyName in request body' });
        }

        if (typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount - must be a positive number' });
        }

        // Get current key data
        const keyData = await getKeyData(keyName);
        if (!keyData) {
            return res.status(404).json({ error: 'Key not found' });
        }

        // Increase daily_limit
        const oldLimit = keyData.daily_limit;
        keyData.daily_limit += amount;

        // Save updated key data
        await redis.set(keyName, keyData);

        return res.status(200).json({
            success: true,
            message: `Daily limit increased by ${amount} for key "${keyName}"`,
            data: {
                keyName,
                old_daily_limit: oldLimit,
                new_daily_limit: keyData.daily_limit,
                amount_added: amount,
                current_usage: keyData.usage_today.count
            }
        });
    } catch (error) {
        console.error('Add quota error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
