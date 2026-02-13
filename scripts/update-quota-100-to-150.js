#!/usr/bin/env node

/**
 * Script cập nhật daily_limit từ 100 lên 150 cho tất cả API keys
 * Sử dụng: node scripts/update-quota-100-to-150.js
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

// Hàm set dữ liệu vào Redis
function redisSet(key, value) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        throw new Error('Thiếu UPSTASH_REDIS_REST_URL hoặc UPSTASH_REDIS_REST_TOKEN');
    }

    const apiUrl = new URL('/set', url);

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify([key, value]);

        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(apiUrl, options, (res) => {
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
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

// Main function
async function main() {
    console.log('\n🔄 === CẬP NHẬT QUOTA TỪ 100 LÊN 150 ===\n');

    try {
        // Lấy tất cả keys
        const keysResponse = await redisRequest('keys', ['api_key:*']);
        const keys = keysResponse.result || [];

        if (keys.length === 0) {
            console.log('⚠️  Không có API key nào trong database.\n');
            return;
        }

        console.log(`Tìm thấy ${keys.length} API key(s)\n`);

        let updatedCount = 0;
        const updatedKeys = [];

        // Xử lý từng key
        for (const key of keys) {
            try {
                const dataResponse = await redisRequest('get', [key]);
                const data = dataResponse.result;

                if (!data || typeof data !== 'object') {
                    console.log(`⏭️  Bỏ qua ${key} (không đúng format)\n`);
                    continue;
                }

                // Kiểm tra nếu daily_limit = 100
                if (data.daily_limit === 100) {
                    // Cập nhật daily_limit lên 150
                    data.daily_limit = 150;

                    // Lưu lại vào Redis
                    await redisSet(key, data);

                    updatedCount++;
                    updatedKeys.push(key);

                    console.log(`✅ Đã cập nhật ${key}`);
                    console.log(`   Daily limit: 100 → 150`);
                    console.log(`   Usage hiện tại: ${data.usage_today?.count || 0}/${data.daily_limit}`);
                    console.log(`   Hết hạn: ${data.expiry}\n`);
                } else {
                    console.log(`⏭️  Bỏ qua ${key} (daily_limit = ${data.daily_limit})\n`);
                }
            } catch (error) {
                console.log(`❌ Lỗi khi xử lý ${key}: ${error.message}\n`);
            }
        }

        // Tổng kết
        console.log('\n📊 === KẾT QUẢ ===\n');
        console.log(`Tổng số key đã kiểm tra: ${keys.length}`);
        console.log(`Số key đã cập nhật: ${updatedCount}`);

        if (updatedKeys.length > 0) {
            console.log('\nDanh sách key đã cập nhật:');
            updatedKeys.forEach((key, index) => {
                console.log(`  ${index + 1}. ${key}`);
            });
        }

        console.log('\n✅ Hoàn tất!\n');

    } catch (error) {
        console.error('❌ Lỗi:', error.message);
    }
}

main();
