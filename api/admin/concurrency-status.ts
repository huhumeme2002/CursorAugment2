
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getBackupProfiles, getConcurrency, getSettings } from '../../lib/redis';
import { BackupProfile } from '../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 1. Get Settings for Default API limit
        const settings = await getSettings();
        const defaultLimit = settings?.concurrency_limit || 100;
        const defaultConcurrency = await getConcurrency('default');

        // 2. Get Backup Profiles
        const backups = await getBackupProfiles();

        // 3. Get Concurrency for each backup
        // IMPORTANT: Use profile.id directly to match proxy.ts: incrementConcurrency(backup.id, limit)
        const backupStatuses = await Promise.all(backups.map(async (profile: BackupProfile) => {
            const current = await getConcurrency(profile.id);
            return {
                id: profile.id,
                name: profile.name,
                limit: profile.concurrency_limit,
                current: current,
                status: getStatus(current, profile.concurrency_limit)
            };
        }));

        const defaultStatus = {
            id: 'default',
            name: 'Default API',
            limit: defaultLimit,
            current: defaultConcurrency,
            status: getStatus(defaultConcurrency, defaultLimit)
        };

        return res.status(200).json({
            default: defaultStatus,
            backups: backupStatuses
        });

    } catch (error) {
        console.error('Error fetching concurrency status:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

function getStatus(current: number, limit: number): 'green' | 'yellow' | 'red' {
    if (current >= limit) return 'red';
    if (current >= limit * 0.8) return 'yellow'; // 80% capacity
    return 'green';
}
