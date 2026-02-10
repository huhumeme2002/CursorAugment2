#!/usr/bin/env node

/**
 * Script liệt kê tất cả API keys trong Redis
 * Sử dụng: node scripts/list-keys.js
 */

const https = require('https');

// Hàm gọi Upstash REST API
function redisRequest(command, args = []) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        throw new Error('Thiếu UPSTASH_REDIS_REST_URL hoặc UPSTASH_REDIS_REST_TOKEN');
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
    console.log('\n📋 === DANH SÁCH API KEYS ===\n');

    try {
        // Lấy tất cả keys
        const keysResponse = await redisRequest('keys', ['*']);
        const keys = keysResponse.result || [];

        if (keys.length === 0) {
            console.log('⚠️  Không có key nào trong database.\n');
            return;
        }

        console.log(`Tìm thấy ${keys.length} key(s):\n`);

        // Lấy thông tin chi tiết của từng key
        for (const key of keys) {
            try {
                const dataResponse = await redisRequest('get', [key]);
                const data = dataResponse.result;

                if (typeof data === 'string') {
                    const parsed = JSON.parse(data);
                    const expired = new Date(parsed.expiry) < new Date();
                    const status = expired ? '❌ HẾT HẠN' : '✅ CÒN HIỆU LỰC';

                    console.log(`🔑 ${key}`);
                    console.log(`   Trạng thái: ${status}`);
                    console.log(`   Hết hạn: ${parsed.expiry}`);
                    console.log(`   Số IP tối đa: ${parsed.max_ips}`);
                    console.log(`   Số IP đã dùng: ${parsed.ips.length}`);
                    if (parsed.ips.length > 0) {
                        console.log(`   IPs: ${parsed.ips.join(', ')}`);
                    }
                    console.log('');
                }
            } catch (error) {
                console.log(`🔑 ${key}`);
                console.log(`   ⚠️  Không thể đọc dữ liệu (có thể không đúng format)\n`);
            }
        }

    } catch (error) {
        console.error('❌ Lỗi:', error.message);
    }
}

main();
