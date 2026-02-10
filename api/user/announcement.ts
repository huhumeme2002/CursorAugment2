import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getActiveAnnouncements } from '../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get active announcements (non-blocking - return empty array on error)
        const announcements = await getActiveAnnouncements();

        return res.status(200).json({
            success: true,
            announcements
        });
    } catch (error) {
        // Non-blocking: return empty array on error
        console.error('Error in user announcement endpoint:', error);
        return res.status(200).json({
            success: true,
            announcements: []
        });
    }
}
