#!/usr/bin/env node

/**
 * Script tự động tạo API key cho khách hàng trong Redis
 * Sử dụng: node scripts/create-key.js
 */

const https = require('https');
const readline = require('readline');

// Tạo interface để nhập liệu
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Hàm hỏi câu hỏi
function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// Hàm tạo key ngẫu nhiên
function generateRandomKey() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'key-';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Hàm validate ngày
function isValidDate(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;

    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return date > today;
}

// Hàm thêm key vào Redis qua Upstash REST API
async function addKeyToRedis(keyName, data) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        throw new Error('Thiếu UPSTASH_REDIS_REST_URL hoặc UPSTASH_REDIS_REST_TOKEN trong .env');
    }

    const apiUrl = new URL('/set/' + encodeURIComponent(keyName), url);

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);

        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(apiUrl, options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(responseData));
                } else {
                    reject(new Error(`Redis API error: ${res.statusCode} - ${responseData}`));
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
    console.log('\n🔑 === TẠO API KEY CHO KHÁCH HÀNG ===\n');

    try {
        // 1. Hỏi tên key
        const useCustomName = await question('Bạn muốn tự đặt tên key? (y/n, mặc định: n): ');
        let keyName;

        if (useCustomName.toLowerCase() === 'y') {
            keyName = await question('Nhập tên key (ví dụ: khach-nguyen-van-a): ');
            if (!keyName || keyName.trim() === '') {
                console.log('❌ Tên key không được để trống!');
                rl.close();
                return;
            }
            keyName = keyName.trim();
        } else {
            keyName = generateRandomKey();
            console.log(`✨ Key tự động: ${keyName}`);
        }

        // 2. Hỏi ngày hết hạn
        let expiry;
        while (true) {
            expiry = await question('Ngày hết hạn (YYYY-MM-DD, ví dụ: 2026-12-31): ');
            if (isValidDate(expiry)) {
                break;
            }
            console.log('❌ Ngày không hợp lệ hoặc đã quá hạn! Vui lòng nhập lại.');
        }

        // 3. Hỏi số IP tối đa
        let maxIps;
        while (true) {
            const input = await question('Số IP tối đa (1-10, mặc định: 1): ');
            maxIps = parseInt(input) || 1;
            if (maxIps >= 1 && maxIps <= 10) {
                break;
            }
            console.log('❌ Số IP phải từ 1 đến 10!');
        }

        // 4. Tạo data
        const keyData = {
            expiry: expiry,
            max_ips: maxIps,
            ips: []
        };

        console.log('\n📝 Thông tin key:');
        console.log(`   Tên key: ${keyName}`);
        console.log(`   Hết hạn: ${expiry}`);
        console.log(`   Số IP tối đa: ${maxIps}`);
        console.log(`   Dữ liệu: ${JSON.stringify(keyData)}`);

        const confirm = await question('\n✅ Xác nhận tạo key này? (y/n): ');
        if (confirm.toLowerCase() !== 'y') {
            console.log('❌ Đã hủy!');
            rl.close();
            return;
        }

        // 5. Thêm vào Redis
        console.log('\n⏳ Đang thêm key vào Redis...');
        await addKeyToRedis(keyName, keyData);

        console.log('\n✅ ========== THÀNH CÔNG ==========');
        console.log(`\n🎉 Key đã được tạo: ${keyName}`);
        console.log('\n📋 Gửi thông tin sau cho khách hàng:');
        console.log('─────────────────────────────────────');
        console.log(`API Key: ${keyName}`);
        console.log(`Ngày hết hạn: ${expiry}`);
        console.log(`Số thiết bị tối đa: ${maxIps}`);
        console.log('─────────────────────────────────────\n');

    } catch (error) {
        console.error('\n❌ Lỗi:', error.message);
    } finally {
        rl.close();
    }
}

// Chạy script
main();
