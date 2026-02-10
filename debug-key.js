// Debug script to check key status
const { Redis } = require('@upstash/redis');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function debugKey(keyName) {
    try {
        console.log(`\n=== DEBUG KEY: ${keyName} ===`);
        
        const data = await redis.get(keyName);
        if (!data) {
            console.log('❌ Key not found in Redis');
            return;
        }
        
        console.log('📊 Key Data:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n📈 Analysis:');
        console.log(`- Max Activations: ${data.max_activations}`);
        console.log(`- Current Activations: ${data.activations}`);
        console.log(`- Activated Devices: ${data.activated_devices.length}`);
        console.log(`- Device IDs: ${JSON.stringify(data.activated_devices)}`);
        
        // Check for inconsistencies
        if (data.activations !== data.activated_devices.length) {
            console.log('⚠️  INCONSISTENCY DETECTED!');
            console.log(`   activations (${data.activations}) != activated_devices.length (${data.activated_devices.length})`);
        }
        
        if (data.activations >= data.max_activations) {
            console.log('🔒 Key should be BLOCKED (reached max activations)');
        } else {
            console.log('✅ Key should allow new activations');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

// Usage: node debug-key.js YOUR_KEY_NAME
const keyName = process.argv[2];
if (!keyName) {
    console.log('Usage: node debug-key.js <key-name>');
    process.exit(1);
}

debugKey(keyName);