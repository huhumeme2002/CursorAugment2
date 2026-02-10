
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deleteAPIProfile } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { id } = req.query;

        if (!id || Array.isArray(id)) {
            return res.status(400).json({ error: 'Profile ID is required' });
        }

        const success = await deleteAPIProfile(id as string);

        if (success) {
            return res.status(200).json({ message: 'Profile deleted' });
        } else {
            return res.status(404).json({ error: 'Profile not found or failed to delete' });
        }
    } catch (error) {
        console.error('Error deleting profile:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
