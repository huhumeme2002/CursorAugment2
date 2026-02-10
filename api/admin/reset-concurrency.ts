
import { VercelRequest, VercelResponse } from '@vercel/node';
import { redis, getBackupProfiles } from '../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { target } = req.body; // 'all', 'default', or backup ID

        if (!target) {
            return res.status(400).json({ error: 'Missing target parameter' });
        }

        if (target === 'all') {
            const keysToDelete = ['concurrency:default'];

            // Get all backup IDs to clear their concurrency keys
            const backups = await getBackupProfiles();
            for (const backup of backups) {
                keysToDelete.push(`concurrency:${backup.id}`);
            }

            if (keysToDelete.length > 0) {
                await redis.del(...keysToDelete);
            }
            console.log(`[ADMIN] Reset ALL concurrency keys: ${keysToDelete.join(', ')}`);

        } else if (target === 'default') {
            await redis.del('concurrency:default');
            console.log(`[ADMIN] Reset DEFAULT concurrency key`);

        } else {
            // Target is a backup ID
            await redis.del(`concurrency:${target}`);
            console.log(`[ADMIN] Reset concurrency key for backup: ${target}`);
        }

        return res.status(200).json({ message: 'Concurrency reset successfully' });

    } catch (error) {
        console.error('Error resetting concurrency:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
