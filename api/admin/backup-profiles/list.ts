import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBackupProfiles } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const profiles = await getBackupProfiles();
        return res.status(200).json({ profiles });
    } catch (error) {
        console.error('Error listing backup profiles:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
