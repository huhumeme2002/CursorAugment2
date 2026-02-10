#!/usr/bin/env node

/**
 * Script xóa API key khỏi Redis
 * Sử dụng: node scripts/delete-key.js <key-name>
 */

const https = require('https');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function redisDelete(keyName) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        throw new Error('Thiếu UPSTASH_REDIS_REST_URL hoặc UPSTASH_REDIS_REST_TOKEN');
    }

    const apiUrl = new URL('/del/' + encodeURIComponent(keyName), url);

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

async function main() {
    const keyName = process.argv[2];

    if (!keyName) {
        console.log('\n❌ Vui lòng cung cấp tên key!');
        console.log('Cách dùng: node scripts/delete-key.js <key-name>');
        console.log('Ví dụ: node scripts/delete-key.js customer-key-123\n');
        rl.close();
        return;
    }

    console.log(`\n⚠️  Bạn đang chuẩn bị XÓA key: ${keyName}`);
    const confirm = await question('Xác nhận xóa? (yes/no): ');

    if (confirm.toLowerCase() !== 'yes') {
        console.log('❌ Đã hủy!\n');
        rl.close();
        return;
    }

    try {
        console.log('⏳ Đang xóa key...');
        const result = await redisDelete(keyName);

        if (result.result === 1) {
            console.log(`✅ Đã xóa key: ${keyName}\n`);
        } else {
            console.log(`⚠️  Key không tồn tại: ${keyName}\n`);
        }
    } catch (error) {
        console.error('❌ Lỗi:', error.message);
    } finally {
        rl.close();
    }
}

main();
