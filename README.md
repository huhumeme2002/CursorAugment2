# Vercel AI Proxy với Admin Panel

🚀 **Hệ thống proxy AI API trên Vercel với quản lý API keys qua Redis và Admin Panel web**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/huhumeme2002/Cursor-Augment)

## ✨ Tính Năng

- ✅ **Activation-based Tracking**: Theo dõi số thiết bị kích hoạt thay vì IP
- ✅ **Admin Panel Web**: Quản lý keys qua giao diện đẹp mắt
- ✅ **Auto-expiry**: Keys tự động hết hạn theo ngày cấu hình
- ✅ **Model Transformation**: Chuyển đổi model names tự động
- ✅ **Stream Response**: Xử lý streaming responses realtime
- ✅ **CORS Support**: Tương thích với Chatbox AI, TypingMind, Cursor

## 🚀 Quick Start

### 1. Deploy lên Vercel

Click button **Deploy with Vercel** ở trên hoặc:

```bash
git clone https://github.com/huhumeme2002/Cursor-Augment.git
cd Cursor-Augment
vercel
```

### 2. Cấu hình Environment Variables

Vào Vercel Dashboard → Settings → Environment Variables, thêm:

```bash
API_KEY_GOC=your-newcli-api-key
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token
ADMIN_PASSWORD=your-admin-password
JWT_SECRET=your-jwt-secret-32-chars
```

**Tạo JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Tạo Upstash Redis

1. Đăng ký tại [Upstash](https://console.upstash.com/)
2. Tạo database Redis (chọn Region **Singapore**)
3. Copy `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN`

### 4. Truy cập Admin Panel

```
https://your-app.vercel.app/admin
```

Login bằng `ADMIN_PASSWORD` đã cấu hình.

## 📖 Sử Dụng

### Tạo API Key

1. Vào Admin Panel: `https://your-app.vercel.app/admin`
2. Click **"Tạo Key Mới"**
3. Điền thông tin:
   - **Tên key**: `khach-nguyen-van-a` (hoặc để trống để auto-generate)
   - **Ngày hết hạn**: `2026-12-31`
   - **Số thiết bị tối đa**: `1`
4. Click **"Tạo Key"**
5. Key sẽ tự động copy vào clipboard

### Sử dụng API

```bash
curl -X POST https://your-app.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude-Opus-4.5-VIP",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Tích hợp với Ứng Dụng

**Chatbox AI / TypingMind / Cursor:**
- API URL: `https://your-app.vercel.app/v1`
- API Key: `your-api-key`
- Model: `Claude-Opus-4.5-VIP`

## 🗂️ Cấu Trúc Project

```
Cursor-Augment/
├── api/
│   ├── admin/           # Admin API endpoints
│   │   ├── login.ts
│   │   └── keys/
│   │       ├── create.ts
│   │       ├── list.ts
│   │       └── delete.ts
│   └── v1/chat/
│       └── completions.ts  # Main AI proxy endpoint
├── lib/
│   ├── auth.ts          # JWT authentication
│   ├── redis.ts         # Redis helpers
│   └── types.ts         # TypeScript types
├── public/admin/
│   ├── index.html       # Admin dashboard UI
│   └── app.js           # Admin dashboard logic
├── scripts/
│   ├── create-key.js    # CLI script to create keys
│   ├── list-keys.js     # CLI script to list keys
│   └── delete-key.js    # CLI script to delete keys
├── vercel.json          # Vercel config với CORS
└── README.md
```

## 📊 Redis Schema

Mỗi API key trong Redis có cấu trúc:

```json
{
  "expiry": "2026-12-31",
  "max_activations": 1,
  "activations": 0,
  "activated_devices": []
}
```

## 🔒 Bảo Mật

- ✅ JWT authentication cho admin panel (24h expiry)
- ✅ Environment variables cho sensitive data
- ✅ HTTPS only (Vercel SSL)
- ✅ Input validation trên tất cả endpoints
- ✅ Auto-migrate legacy keys

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run locally với Vercel dev
vercel dev

# TypeScript check
npx tsc --noEmit

# Deploy to production
vercel --prod
```

## 📝 License

MIT

## 🤝 Contributing

Pull requests are welcome! 

## 💬 Support

Mở issue nếu bạn gặp vấn đề hoặc có câu hỏi.
