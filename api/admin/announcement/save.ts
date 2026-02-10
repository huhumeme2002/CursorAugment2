import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../../lib/auth';
import { saveAnnouncement } from '../../../lib/redis';
import { Announcement } from '../../../lib/types';
import { randomUUID } from 'crypto';

/**
 * Basic HTML sanitization to prevent XSS attacks
 * Removes script tags and dangerous attributes
 */
function sanitizeHtml(html: string): string {
    if (!html) return '';

    return html
        // Remove script tags and their content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Remove event handlers (onclick, onerror, etc.)
        .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '')
        // Remove javascript: protocol
        .replace(/javascript:/gi, '')
        // Remove data: protocol (can be used for XSS)
        .replace(/data:text\/html/gi, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
    if (req.method !== 'POST') {
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

        // Validate request body
        const { id, title, content, type, priority, is_active, start_time, end_time } = req.body;

        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return res.status(400).json({ error: 'Title is required' });
        }

        if (title.trim().length > 200) {
            return res.status(400).json({ error: 'Title must be 200 characters or less' });
        }

        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            return res.status(400).json({ error: 'Content is required' });
        }

        if (content.trim().length > 2000) {
            return res.status(400).json({ error: 'Content must be 2000 characters or less' });
        }

        if (!type || !['info', 'warning', 'error', 'success'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type. Must be: info, warning, error, or success' });
        }

        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ error: 'is_active must be a boolean' });
        }

        const priorityNum = typeof priority === 'number' ? priority : 0;

        // Validate dates if provided
        if (start_time && isNaN(Date.parse(start_time))) {
            return res.status(400).json({ error: 'Invalid start_time format' });
        }

        if (end_time && isNaN(Date.parse(end_time))) {
            return res.status(400).json({ error: 'Invalid end_time format' });
        }

        const now = Date.now();
        const announcementId = id || randomUUID();

        // Sanitize HTML content to prevent XSS
        const sanitizedTitle = sanitizeHtml(title.trim());
        const sanitizedContent = sanitizeHtml(content.trim());

        const announcement: Announcement = {
            id: announcementId,
            title: sanitizedTitle,
            content: sanitizedContent,
            type,
            priority: priorityNum,
            is_active,
            start_time: start_time || undefined,
            end_time: end_time || undefined,
            created_at: id ? (req.body.created_at || now) : now,
            updated_at: now
        };

        const success = await saveAnnouncement(announcement);

        if (!success) {
            return res.status(500).json({ error: 'Failed to save announcement' });
        }

        return res.status(200).json({
            success: true,
            announcement
        });
    } catch (error) {
        console.error('Error saving announcement:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
