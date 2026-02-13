#!/usr/bin/env node

/**
 * Script cập nhật daily_limit từ 100 lên 150 cho tất cả API keys
 * Sử dụng: node scripts/update-quota-100-to-150.js
 */

require('dotenv').config();
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

// Hàm set dữ liệu vào Redis (sử dụng GET endpoint với /set/key/value format)
function redisSet(key, value) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        throw new Error('Thiếu UPSTASH_REDIS_REST_URL hoặc UPSTASH_REDIS_REST_TOKEN');
    }

    // Upstash REST API format: /set/key/value
    const endpoint = '/set/' + encodeURIComponent(key) + '/' + encodeURIComponent(value);
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
    console.log('\n🔄 === CẬP NHẬT QUOTA TỪ 100 LÊN 150 ===\n');

    try {
        // Lấy tất cả keys (UUID format, không có prefix)
        const keysResponse = await redisRequest('keys', ['*']);
        let keys = keysResponse.result || [];

        if (keys.length === 0) {
            console.log('⚠️  Không có key nào trong database.\n');
            return;
        }

        // Lọc chỉ lấy keys có format UUID (bỏ qua các keys khác như settings, profiles, etc.)
        keys = keys.filter(key => {
            return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(key);
        });

        if (keys.length === 0) {
            console.log('⚠️  Không có API key nào (UUID format) trong database.\n');
            return;
        }

        console.log(`Tìm thấy ${keys.length} API key(s)\n`);

        let updatedCount = 0;
        const updatedKeys = [];

        // Xử lý từng key
        for (const key of keys) {
            try {
                const dataResponse = await redisRequest('get', [key]);
                let data = dataResponse.result;

                // Parse JSON nếu data là string
                if (typeof data === 'string') {
                    try {
                        data = JSON.parse(data);
                    } catch (e) {
                        console.log(`⏭️  Bỏ qua ${key} (không parse được JSON)\n`);
                        continue;
                    }
                }

                if (!data || typeof data !== 'object') {
                    console.log(`⏭️  Bỏ qua ${key} (không đúng format)\n`);
                    continue;
                }

                // Kiểm tra nếu daily_limit = 100
                if (data.daily_limit === 100) {
                    // Cập nhật daily_limit lên 150
                    data.daily_limit = 150;

                    // Lưu lại vào Redis (phải stringify vì Redis lưu dạng string)
                    await redisSet(key, JSON.stringify(data));

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
