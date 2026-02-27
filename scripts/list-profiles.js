#!/usr/bin/env node

/**
 * Script to list all API profiles in Redis
 * Usage: node scripts/list-profiles.js
 */

const https = require('https');

// Function to call Upstash REST API
function redisRequest(command, args = []) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        throw new Error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
    }

    const endpoint = '/' + command + '/' + args.map(a => encodeURIComponent(a)).join('/');
    const apiUrl = new URL(endpoint, url);

    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };

        https.get(apiUrl, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Redis API error: ${res.statusCode} - ${data}`));
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

// Main function
async function main() {
    console.log('\n📋 === API PROFILES ===\n');

    try {
        // Get all profile keys
        const keysResponse = await redisRequest('keys', ['api_profile:*']);
        const keys = keysResponse.result || [];

        if (keys.length === 0) {
            console.log('⚠️  No API profiles found.\n');
            return;
        }

        console.log(`Found ${keys.length} profile(s):\n`);

        // Get details for each profile
        for (const key of keys) {
            try {
                const dataResponse = await redisRequest('get', [key]);
                const data = dataResponse.result;

                if (typeof data === 'string') {
                    const profile = JSON.parse(data);
                    const status = profile.is_active ? '✅ ACTIVE' : '❌ INACTIVE';

                    console.log(`🔧 ${key}`);
                    console.log(`   Name: ${profile.name}`);
                    console.log(`   Status: ${status}`);
                    console.log(`   API URL: ${profile.api_url}`);
                    console.log(`   Model Actual: ${profile.model_actual || '(not set)'}`);
                    console.log(`   Disable System Prompt: ${profile.disable_system_prompt_injection || false}`);
                    console.log(`   System Prompt Format: ${profile.system_prompt_format || 'auto'}`);
                    console.log(`   Capabilities: ${profile.capabilities?.join(', ') || 'none'}`);
                    console.log(`   Speed: ${profile.speed || 'medium'}`);
                    console.log('');
                }
            } catch (error) {
                console.log(`🔧 ${key}`);
                console.log(`   ⚠️  Cannot read data (invalid format)\n`);
            }
        }

        // Also check settings
        console.log('\n📋 === GLOBAL SETTINGS ===\n');
        try {
            const settingsResponse = await redisRequest('get', ['settings']);
            const settingsData = settingsResponse.result;
            if (settingsData && typeof settingsData === 'string') {
                const settings = JSON.parse(settingsData);
                console.log('Global System Prompt Format:', settings.system_prompt_format || 'auto');
                console.log('Global System Prompt:', settings.system_prompt ? `${settings.system_prompt.substring(0, 100)}...` : '(not set)');
                console.log('Model Actual:', settings.model_actual || '(not set)');
                console.log('');
            }
        } catch (error) {
            console.log('⚠️  Cannot read global settings\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

main();
