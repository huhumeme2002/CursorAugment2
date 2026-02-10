import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBackupProfiles, saveBackupProfiles } from '../../../lib/redis';
import { BackupProfile } from '../../../lib/types';
import { randomUUID } from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { name, api_key, api_url, model_actual, concurrency_limit, speed } = req.body;

        if (!name || !api_key || !api_url || concurrency_limit === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const profiles = await getBackupProfiles();

        const newProfile: BackupProfile = {
            id: randomUUID(),
            name,
            api_key,
            api_url,
            model_actual: model_actual || undefined,
            concurrency_limit: Number(concurrency_limit),
            speed: speed || 'medium',
            capabilities: [],
            is_active: true
        };

        profiles.push(newProfile);
        await saveBackupProfiles(profiles);

        return res.status(200).json(newProfile);
    } catch (error) {
        console.error('Error creating backup profile:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
