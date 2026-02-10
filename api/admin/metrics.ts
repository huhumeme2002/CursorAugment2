import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../lib/auth';
import { metrics } from '../../lib/metrics';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify admin authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = verifyToken(token);
        if (!decoded) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Get metrics snapshot
        const metricsData = metrics.getMetrics();

        return res.status(200).json({
            success: true,
            timestamp: new Date().toISOString(),
            metrics: metricsData,
        });
    } catch (error) {
        console.error('Error fetching metrics:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}
