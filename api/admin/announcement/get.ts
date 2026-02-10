import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { getAnnouncements } from '../../../lib/redis';

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

        // Get all announcements
        const announcements = await getAnnouncements();

        // Return the first active announcement, or null if none exists
        const activeAnnouncement = announcements.find(a => a.is_active) || null;

        return res.status(200).json({
            success: true,
            announcement: activeAnnouncement
        });
    } catch (error) {
        console.error('Error getting announcement:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
