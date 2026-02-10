import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { getModelConfigs } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow GET
    if (req.method !== 'GET') {
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

        // Get all model configs
        const models = await getModelConfigs();

        return res.status(200).json({
            models: Object.entries(models).map(([id, config]) => ({
                id,
                name: config.name,
                system_prompt: config.system_prompt
            })),
            count: Object.keys(models).length
        });
    } catch (error) {
        console.error('Error in models list:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
