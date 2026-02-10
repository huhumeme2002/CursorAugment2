import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { createKey } from '../../../lib/redis';

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

        // Validate request body
        const { name, expiry, daily_limit } = req.body;

        if (!name || !expiry) {
            return res.status(400).json({
                error: 'Missing required fields: name, expiry'
            });
        }

        // Validate expiry date format
        const expiryRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!expiryRegex.test(expiry)) {
            return res.status(400).json({
                error: 'Invalid expiry format. Use YYYY-MM-DD'
            });
        }

        // Validate expiry is in the future
        const expiryDate = new Date(expiry);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (expiryDate <= today) {
            return res.status(400).json({
                error: 'Expiry date must be in the future'
            });
        }

        // Validate daily_limit
        const dailyLimitNum = daily_limit && typeof daily_limit === 'number' ? daily_limit : 100;
        if (dailyLimitNum < 1 || dailyLimitNum > 10000) {
            return res.status(400).json({
                error: 'daily_limit must be a number between 1 and 10000'
            });
        }

        // Create the key
        const result = await createKey(name, expiry, dailyLimitNum);

        if (!result.success) {
            return res.status(500).json({ error: 'Failed to create key' });
        }

        return res.status(201).json({
            success: true,
            message: 'Key created successfully',
            key: {
                name,
                expiry,
                daily_limit: dailyLimitNum
            }
        });
    } catch (error) {
        console.error('Create key error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
