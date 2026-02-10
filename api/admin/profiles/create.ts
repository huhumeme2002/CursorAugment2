
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { saveAPIProfile } from '../../../lib/redis';
import { generateUUID } from '../../../lib/utils';
import { APIProfile } from '../../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { name, api_key, api_url, model_actual, capabilities, speed, description, is_active } = req.body;

        if (!name || !api_key || !api_url) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const newProfile: APIProfile = {
            id: generateUUID(),
            name,
            api_key,
            api_url,
            model_actual: model_actual || undefined,
            capabilities: Array.isArray(capabilities) ? capabilities : [],
            speed: speed || 'medium',
            description: description || '',
            is_active: is_active !== undefined ? is_active : true
        };

        const success = await saveAPIProfile(newProfile);

        if (success) {
            return res.status(201).json({ message: 'Profile created', profile: newProfile });
        } else {
            return res.status(500).json({ error: 'Failed to create profile' });
        }
    } catch (error) {
        console.error('Error creating profile:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
