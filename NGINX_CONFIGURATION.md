# Nginx Configuration for VPS Deployment

## Overview

This document provides the required nginx configuration to prevent 504 Gateway Timeout errors when deploying CursorAugment2 on a VPS.

## Required Timeout Settings

Add these directives to your nginx server block that proxies to the Node.js application:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        
        # Essential timeout settings to prevent 504 errors
        proxy_read_timeout 300s;      # Wait up to 5 minutes for response
        proxy_connect_timeout 60s;     # Connection establishment timeout
        proxy_send_timeout 300s;       # Timeout for sending request to backend
        
        # Keep-alive settings for streaming
        proxy_set_header Connection '';
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Disable buffering for SSE streaming
        proxy_buffering off;
        proxy_cache off;
    }
}
```

## Configuration Explanation

### Timeout Settings

- **`proxy_read_timeout 300s`**: Maximum time nginx waits for data from the backend. Set to 5 minutes to match the application server timeout.
- **`proxy_connect_timeout 60s`**: Maximum time to establish a connection to the backend.
- **`proxy_send_timeout 300s`**: Maximum time to send a request to the backend.

### Streaming Settings

- **`proxy_buffering off`**: Disables response buffering, essential for Server-Sent Events (SSE)
- **`proxy_cache off`**: Disables caching for real-time streaming responses
- **`Connection "upgrade"`**: Enables WebSocket/SSE upgrade support

### Why These Settings Matter

AI model generations can take 30-120 seconds, especially for:
- Long responses with thinking mode
- Complex reasoning tasks
- Extended tool use chains

Without proper timeout configuration, nginx will terminate the connection before the AI finishes responding, resulting in 504 errors.

## Application Features That Prevent Timeouts

The application includes built-in mechanisms to work with these nginx settings:

1. **SSE Heartbeat**: Sends `:heartbeat\n\n` every 15 seconds during streaming to keep the connection alive
2. **Initial Connection Message**: Sends `:connected\n\n` immediately when streaming starts
3. **300s Application Timeout**: Matches nginx timeout configuration

## Applying Configuration

### Method 1: Edit main nginx config

```bash
sudo nano /etc/nginx/sites-available/your-site
# Add the timeout settings to your location block
sudo nginx -t  # Test configuration
sudo systemctl reload nginx
```

### Method 2: Include file

Create a separate config file:

```bash
sudo nano /etc/nginx/snippets/proxy-timeouts.conf
```

Add the timeout settings, then include in your server block:

```nginx
server {
    # ... other settings ...
    location / {
        include snippets/proxy-timeouts.conf;
        proxy_pass http://localhost:3000;
    }
}
```

## Verification

After applying the configuration:

1. Reload nginx: `sudo nginx -s reload`
2. Test with a long-running request:
   ```bash
   curl -X POST https://your-domain.com/v1/chat/completions \
     -H "Authorization: Bearer your-key" \
     -H "Content-Type: application/json" \
     -d '{"model": "Claude-Opus-4.5-VIP", "messages": [{"role": "user", "content": "Write a detailed 2000-word essay on quantum computing"}], "stream": true}' \
     --no-buffer
   ```
3. You should see:
   - `:connected` message immediately
   - `:heartbeat` messages every 15 seconds
   - Complete response without 504 errors

## Troubleshooting

### Still Getting 504 Errors?

1. **Check nginx error logs**:
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

2. **Verify timeout settings are applied**:
   ```bash
   sudo nginx -T | grep timeout
   ```

3. **Check application logs**:
   ```bash
   pm2 logs
   # or
   journalctl -u your-service -f
   ```

4. **Verify server timeout**:
   The `server.ts` file sets server timeout to 300s (line 118). Ensure this matches nginx settings.

### Common Issues

- **Multiple location blocks**: Ensure timeout settings are in the correct location block
- **Inherited values**: Child location blocks inherit parent timeouts, so check parent blocks
- **Cloudflare/CDN**: If using a CDN, it may have its own timeout settings (usually 100s for free tier)

## Additional Resources

- [Nginx Proxy Module Docs](http://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [SSE Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
