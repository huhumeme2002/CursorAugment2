
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAPIProfiles, getKeyData, isExpired } from '../../lib/redis';
import { APIProfile } from '../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
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

        const profiles = await getAPIProfiles();

        // Filter for active profiles only and sanitise sensitive data (api_key)
        const availableProfiles = Object.values(profiles)
            .filter((p: APIProfile) => p.is_active)
            .map(({ api_key, api_url, model_actual, ...rest }) => rest); // Exclude sensitive data from response

        return res.status(200).json({
            profiles: availableProfiles,
            selected_profile_id: keyData.selected_api_profile_id || null
        });

    } catch (error) {
        console.error('Error fetching user profiles:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
