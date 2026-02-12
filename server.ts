import 'dotenv/config'; // Load env vars before anything else
import express from 'express';
import cors from 'cors';
import path from 'path';
import handler from './api/proxy';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Support large payloads
app.use(express.text({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve static files from public directory (no cache for JS files)
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Serve admin index.html for /admin route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Dynamic API Route Handler
// Maps /api/path/to/route -> ./api/path/to/route.ts
app.all('/api/*', async (req, res) => {
    const routePath = req.path; // e.g., /api/admin/keys/list

    // 1. Handle special case: Proxy
    if (routePath === '/api/proxy') {
        try {
            return await handler(req as any, res as any);
        } catch (error) {
            console.error('Proxy Error:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // 2. Map other API routes dynamically
    try {
        // Remove /api prefix
        const relativePath = routePath.replace('/api', '');

        // Construct potential file paths
        // We need to resolve this against the project root to ensure we don't traverse out
        const apiDir = path.join(__dirname, 'api');
        const resolvedPath = path.join(apiDir, relativePath);

        // Security Check: Prevent directory traversal
        if (!resolvedPath.startsWith(apiDir)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Check if file exists before trying to require it
        // We support .ts files (and potentially .js if compiled, but let's stick to source for now or handle both)
        // practical approach: check modulePath, then modulePath.ts

        // Note: 'require' resolves relative to the file calling it, but fs functions resolve relative to CWD.
        // Since we are running from project root, './api' works. 
        // Better to use absolute paths for fs checks.

        let moduleToLoad = resolvedPath;
        const fs = require('fs');

        if (fs.existsSync(moduleToLoad) && fs.lstatSync(moduleToLoad).isFile()) {
            // exact match
        } else if (fs.existsSync(resolvedPath + '.ts')) {
            moduleToLoad = resolvedPath + '.ts';
        } else if (fs.existsSync(resolvedPath + '.js')) {
            moduleToLoad = resolvedPath + '.js';
        } else {
            // File not found - return 404 silently
            // console.log(`[DynamicRouter] Route not found: ${routePath}`); // Optional: debug log
            return res.status(404).json({
                error: 'API endpoint not found',
                path: routePath
            });
        }

        console.log(`[DynamicRouter] Routing ${routePath} -> ${moduleToLoad}`);

        try {
            const routeModule = require(moduleToLoad);

            // Execute handler (default export)
            if (routeModule.default) {
                await routeModule.default(req, res);
            } else {
                console.error(`[DynamicRouter] No default export in ${moduleToLoad}`);
                res.status(404).json({ error: 'Endpoint not found or invalid export' });
            }
        } catch (loadError: any) {
            // Check if it's a syntax error or runtime error during require
            console.error(`[DynamicRouter] Error loading module ${moduleToLoad}:`, loadError);
            res.status(500).json({
                error: 'Internal API error',
                message: loadError.message,
                // stack: loadError.stack // Hide stack in production/logs for this
            });
        }

    } catch (error: any) {
        // Should not happen with the new logic, but catch-all
        console.error(`[DynamicRouter] Unexpected error processing ${routePath}:`, error);
        res.status(500).json({
            error: 'Internal API error',
            message: error.message
        });
    }
});

// Legacy /v1/* routes
app.all('/v1/*', async (req, res) => {
    // Rewrite path to match what the proxy expects
    // The proxy logic in api/proxy.ts uses req.url. 
    // In Express, req.url includes the path.
    try {
        await handler(req as any, res as any);
    } catch (error) {
        console.error('Unhandled error in v1 route:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`- Proxy endpoint: http://localhost:${PORT}/api/proxy`);
    console.log(`- Health check: http://localhost:${PORT}/health`);
});

// Increase timeout to 5 minutes (300,000 ms) to avoid 504 errors on long generations
server.setTimeout(300000);
