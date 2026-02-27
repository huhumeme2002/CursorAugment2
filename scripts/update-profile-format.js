#!/usr/bin/env node

/**
 * Script to update system_prompt_format for a specific API profile
 * Usage: node scripts/update-profile-format.js <profile_id> <format>
 * Example: node scripts/update-profile-format.js abc-123 user_message
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
    const profileId = process.argv[2];
    const format = process.argv[3] || 'user_message';

    if (!profileId) {
        console.error('❌ Usage: node scripts/update-profile-format.js <profile_id> <format>');
        console.error('   Formats: auto, anthropic, openai, both, user_message');
        console.error('\n   First, list profiles to get profile_id:');
        console.error('   node scripts/list-profiles.js');
        process.exit(1);
    }

    const validFormats = ['auto', 'anthropic', 'openai', 'both', 'user_message'];
    if (!validFormats.includes(format)) {
        console.error(`❌ Invalid format: ${format}`);
        console.error(`   Valid formats: ${validFormats.join(', ')}`);
        process.exit(1);
    }

    console.log(`\n🔧 Updating profile: api_profile:${profileId}`);
    console.log(`   Setting system_prompt_format to: ${format}\n`);

    try {
        // Get current profile data
        const dataResponse = await redisRequest('get', [`api_profile:${profileId}`]);
        const data = dataResponse.result;

        if (!data) {
            console.error(`❌ Profile not found: api_profile:${profileId}`);
            process.exit(1);
        }

        const profile = typeof data === 'string' ? JSON.parse(data) : data;

        // Update the format
        profile.system_prompt_format = format;
        profile.disable_system_prompt_injection = false; // Ensure injection is enabled

        // Save back to Redis
        await redisRequest('set', [`api_profile:${profileId}`, JSON.stringify(profile)]);

        console.log('✅ Profile updated successfully!');
        console.log('\nUpdated profile:');
        console.log(`   Name: ${profile.name}`);
        console.log(`   API URL: ${profile.api_url}`);
        console.log(`   System Prompt Format: ${profile.system_prompt_format}`);
        console.log(`   Disable System Prompt: ${profile.disable_system_prompt_injection}`);
        console.log('');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
