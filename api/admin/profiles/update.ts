
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAPIProfile, saveAPIProfile } from '../../../lib/redis';
import { APIProfile } from '../../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'PUT') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { id, name, api_key, api_url, model_actual, capabilities, speed, description, is_active, disable_system_prompt_injection, system_prompt_format } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'Profile ID is required' });
        }

        const existingProfile = await getAPIProfile(id);
        if (!existingProfile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        const updatedProfile: APIProfile = {
            ...existingProfile,
            name: name || existingProfile.name,
            api_key: api_key || existingProfile.api_key,
            api_url: api_url || existingProfile.api_url,
            model_actual: model_actual !== undefined ? model_actual : existingProfile.model_actual,
            capabilities: capabilities !== undefined ? capabilities : existingProfile.capabilities,
            speed: speed || existingProfile.speed,
            description: description !== undefined ? description : existingProfile.description,
            is_active: is_active !== undefined ? is_active : existingProfile.is_active,
            disable_system_prompt_injection: disable_system_prompt_injection !== undefined ? disable_system_prompt_injection : existingProfile.disable_system_prompt_injection,
            system_prompt_format: system_prompt_format !== undefined ? system_prompt_format : existingProfile.system_prompt_format
        };

        const success = await saveAPIProfile(updatedProfile);

        if (success) {
            return res.status(200).json({ message: 'Profile updated', profile: updatedProfile });
        } else {
            return res.status(500).json({ error: 'Failed to update profile' });
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
