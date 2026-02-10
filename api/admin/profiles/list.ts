
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAPIProfiles } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const profiles = await getAPIProfiles();
        return res.status(200).json({ profiles });
    } catch (error) {
        console.error('Error listing profiles:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
