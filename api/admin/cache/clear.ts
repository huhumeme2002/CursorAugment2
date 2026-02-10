import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSettingsCache } from '../../../lib/redis';
import { verifyToken } from '../../../lib/auth';

/**
 * Admin endpoint to manually clear the settings cache
 * Useful for forcing immediate refresh after configuration changes
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
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

        clearSettingsCache();
        console.log('[ADMIN] Settings cache manually cleared');

        return res.status(200).json({
            success: true,
            message: 'Settings cache cleared successfully'
        });
    } catch (error) {
        console.error('Error clearing cache:', error);
        return res.status(500).json({ error: 'Failed to clear cache' });
    }
}
