import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAdminPassword, generateToken } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password required' });
        }

        // Verify password
        if (!verifyAdminPassword(password)) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // Generate JWT token
        const token = generateToken({ admin: true });

        return res.status(200).json({
            success: true,
            token,
            expiresIn: '24h'
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
