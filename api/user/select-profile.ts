
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setKeySelectedProfile, getKeyData, isExpired } from '../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
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

        const { profile_id } = req.body;

        // Validation: profile_id can be string or null (to reset)
        if (profile_id !== null && typeof profile_id !== 'string') {
            return res.status(400).json({ error: 'Invalid profile_id' });
        }

        const success = await setKeySelectedProfile(userToken, profile_id);

        if (success) {
            return res.status(200).json({
                message: 'API Profile updated successfully',
                selected_profile_id: profile_id
            });
        } else {
            return res.status(400).json({ error: 'Failed to update profile. Profile might not exist.' });
        }

    } catch (error) {
        console.error('Error selecting profile:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
