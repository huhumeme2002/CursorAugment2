import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBackupProfiles, saveBackupProfiles } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { id } = req.query;

        if (!id || typeof id !== 'string') {
            return res.status(400).json({ error: 'Missing profile ID' });
        }

        const profiles = await getBackupProfiles();
        const filteredProfiles = profiles.filter(p => p.id !== id);

        if (profiles.length === filteredProfiles.length) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        await saveBackupProfiles(filteredProfiles);

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting backup profile:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
