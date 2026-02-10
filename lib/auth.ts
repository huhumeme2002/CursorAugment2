import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const JWT_EXPIRY = '24h';

/**
 * Generate JWT token
 */
export function generateToken(payload: any): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): any {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

/**
 * Verify admin password
 */
export function verifyAdminPassword(password: string): boolean {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        console.error('ADMIN_PASSWORD not set in environment variables');
        return false;
    }
    return password === adminPassword;
}
