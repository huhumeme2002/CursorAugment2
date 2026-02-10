import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { deleteModelConfig, getModelConfigs } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow DELETE
    if (req.method !== 'DELETE') {
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

        // Get model_id from query
        const modelId = req.query.model_id as string;

        if (!modelId) {
            return res.status(400).json({ error: 'Model ID is required' });
        }

        // Check if model exists
        const models = await getModelConfigs();
        if (!models[modelId]) {
            return res.status(404).json({ error: 'Model not found' });
        }

        // Delete model config
        const success = await deleteModelConfig(modelId);

        if (!success) {
            return res.status(500).json({ error: 'Failed to delete model configuration' });
        }

        return res.status(200).json({
            success: true,
            message: `Model "${modelId}" deleted successfully`
        });
    } catch (error) {
        console.error('Error in models delete:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
