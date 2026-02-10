import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { deleteKey } from '../../../lib/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow DELETE
    if (req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify JWT token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = verifyToken(token);

        if (!decoded || !decoded.admin) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Get key name from query
        const { name } = req.query;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Missing key name in query' });
        }

        // Delete the key
        const success = await deleteKey(name);

        if (!success) {
            return res.status(404).json({ error: 'Key not found or failed to delete' });
        }

        return res.status(200).json({
            success: true,
            message: `Key "${name}" deleted successfully`
        });
    } catch (error) {
        console.error('Delete key error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
