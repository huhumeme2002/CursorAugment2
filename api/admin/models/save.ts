import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { saveModelConfig } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
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

        // Get model data from request body
        const { model_id, name, system_prompt } = req.body;

        // Validate required fields
        if (!model_id || typeof model_id !== 'string') {
            return res.status(400).json({ error: 'Model ID is required' });
        }

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Model name is required' });
        }

        // Validate model_id format (lowercase, no spaces)
        const cleanModelId = model_id.toLowerCase().trim().replace(/\s+/g, '-');
        if (!/^[a-z0-9_-]+$/.test(cleanModelId)) {
            return res.status(400).json({
                error: 'Invalid model ID format',
                message: 'Model ID can only contain lowercase letters, numbers, hyphens, and underscores'
            });
        }

        // Save model config
        const success = await saveModelConfig(cleanModelId, {
            name: name.trim(),
            system_prompt: system_prompt || ''
        });

        if (!success) {
            return res.status(500).json({ error: 'Failed to save model configuration' });
        }

        return res.status(200).json({
            success: true,
            message: `Model "${name}" saved successfully`,
            model: {
                id: cleanModelId,
                name: name.trim(),
                system_prompt: system_prompt || ''
            }
        });
    } catch (error) {
        console.error('Error in models save:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
