import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKeyData, isExpired, getModelConfigs, setKeySelectedModel } from '../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // ====================
        // AUTHENTICATION
        // ====================
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid Authorization header' });
        }

        const userToken = authHeader.replace('Bearer ', '');
        const keyData = await getKeyData(userToken);

        if (!keyData) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        if (isExpired(keyData.expiry)) {
            return res.status(403).json({ error: 'API key has expired' });
        }

        // Get available models
        const modelConfigs = await getModelConfigs();
        const availableModels = ['default', ...Object.keys(modelConfigs)];

        // ====================
        // GET - List available models and current selection
        // ====================
        if (req.method === 'GET') {
            return res.status(200).json({
                selected_model: keyData.selected_model || 'default',
                available_models: availableModels,
                models: Object.fromEntries(
                    Object.entries(modelConfigs).map(([id, config]) => [id, { name: config.name }])
                )
            });
        }

        // ====================
        // POST - Select a model
        // ====================
        if (req.method === 'POST') {
            const { model } = req.body;

            if (!model || typeof model !== 'string') {
                return res.status(400).json({ error: 'Model is required' });
            }

            const modelId = model.toLowerCase().trim();

            // Validate model exists
            if (modelId !== 'default' && !modelConfigs[modelId]) {
                return res.status(400).json({
                    error: 'Invalid model',
                    message: `Model "${model}" is not available. Available models: ${availableModels.join(', ')}`,
                    available_models: availableModels
                });
            }

            // Set selected model (null to clear/use default)
            const success = await setKeySelectedModel(
                userToken,
                modelId === 'default' ? null : modelId
            );

            if (!success) {
                return res.status(500).json({ error: 'Failed to update model selection' });
            }

            const modelName = modelId === 'default'
                ? 'Default'
                : modelConfigs[modelId]?.name || modelId;

            return res.status(200).json({
                success: true,
                selected_model: modelId,
                message: `Model changed to ${modelName}`
            });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Error in user model handler:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
