# Scripts Quản Lý API Keys

Thư mục này chứa các script giúp bạn quản lý API keys trong Redis một cách dễ dàng.

## 📋 Danh Sách Scripts

### 1. `create-key.js` - Tạo Key Mới

Tạo API key mới cho khách hàng với giao diện tương tác.

**Cách dùng:**
```bash
node scripts/create-key.js
```

**Tính năng:**
- ✅ Tự động tạo tên key ngẫu nhiên hoặc cho phép tự đặt tên
- ✅ Validate ngày hết hạn (phải > ngày hiện tại)
- ✅ Cho phép cấu hình số IP tối đa (1-10)
- ✅ Xác nhận trước khi tạo
- ✅ Hiển thị thông tin để gửi cho khách hàng

**Ví dụ output:**
```
🔑 === TẠO API KEY CHO KHÁCH HÀNG ===

Bạn muốn tự đặt tên key? (y/n, mặc định: n): n
✨ Key tự động: key-a7f3d9k2x5p1

Ngày hết hạn (YYYY-MM-DD, ví dụ: 2026-12-31): 2026-12-31
Số IP tối đa (1-10, mặc định: 1): 1

📝 Thông tin key:
   Tên key: key-a7f3d9k2x5p1
   Hết hạn: 2026-12-31
   Số IP tối đa: 1
   Dữ liệu: {"expiry":"2026-12-31","max_ips":1,"ips":[]}

✅ Xác nhận tạo key này? (y/n): y

⏳ Đang thêm key vào Redis...

✅ ========== THÀNH CÔNG ==========

🎉 Key đã được tạo: key-a7f3d9k2x5p1

📋 Gửi thông tin sau cho khách hàng:
─────────────────────────────────────
API Key: key-a7f3d9k2x5p1
Ngày hết hạn: 2026-12-31
Số thiết bị tối đa: 1
─────────────────────────────────────
```

---

### 2. `list-keys.js` - Xem Danh Sách Keys

Hiển thị tất cả API keys và trạng thái của chúng.

**Cách dùng:**
```bash
node scripts/list-keys.js
```

**Tính năng:**
- ✅ Liệt kê tất cả keys trong database
- ✅ Hiển thị trạng thái (còn hiệu lực/hết hạn)
- ✅ Thông tin chi tiết: ngày hết hạn, số IP đã dùng/tối đa
- ✅ Danh sách IP addresses đã sử dụng key

**Ví dụ output:**
```
📋 === DANH SÁCH API KEYS ===

Tìm thấy 3 key(s):

🔑 customer-key-123
   Trạng thái: ✅ CÒN HIỆU LỰC
   Hết hạn: 2026-12-31
   Số IP tối đa: 1
   Số IP đã dùng: 1
   IPs: 103.45.67.89

🔑 premium-key-456
   Trạng thái: ✅ CÒN HIỆU LỰC
   Hết hạn: 2027-06-30
   Số IP tối đa: 2
   Số IP đã dùng: 0

🔑 expired-key-old
   Trạng thái: ❌ HẾT HẠN
   Hết hạn: 2024-01-01
   Số IP tối đa: 1
   Số IP đã dùng: 1
   IPs: 192.168.1.1
```

---

### 3. `delete-key.js` - Xóa Key

Xóa một API key khỏi Redis (có xác nhận an toàn).

**Cách dùng:**
```bash
node scripts/delete-key.js <tên-key>
```

**Ví dụ:**
```bash
node scripts/delete-key.js customer-key-123
```

**Tính năng:**
- ✅ Yêu cầu xác nhận "yes" trước khi xóa
- ✅ Thông báo rõ ràng khi xóa thành công/thất bại
- ✅ An toàn, tránh xóa nhầm

**Ví dụ output:**
```
⚠️  Bạn đang chuẩn bị XÓA key: customer-key-123
Xác nhận xóa? (yes/no): yes
⏳ Đang xóa key...
✅ Đã xóa key: customer-key-123
```

---

## ⚙️ Cấu Hình

### Yêu Cầu

Các script này yêu cầu **environment variables** để kết nối với Upstash Redis:

```bash
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here
```

### Cách Thiết Lập

**Option 1: Sử dụng file `.env`** (khuyến nghị cho local)

1. Tạo file `.env` trong thư mục gốc project:
```bash
cp .env.example .env
```

2. Điền thông tin Redis vào file `.env`

3. Cài đặt `dotenv`:
```bash
npm install dotenv
```

4. Chạy script với dotenv:
```bash
node -r dotenv/config scripts/create-key.js
```

**Option 2: Set trực tiếp trong terminal**

**Windows PowerShell:**
```powershell
$env:UPSTASH_REDIS_REST_URL="https://your-instance.upstash.io"
$env:UPSTASH_REDIS_REST_TOKEN="your-token-here"
node scripts/create-key.js
```

**Linux/Mac:**
```bash
export UPSTASH_REDIS_REST_URL="https://your-instance.upstash.io"
export UPSTASH_REDIS_REST_TOKEN="your-token-here"
node scripts/create-key.js
```

---

## 🎯 Workflow Quản Lý Khách Hàng

### Khi có khách hàng mới:
```bash
# 1. Tạo key
node scripts/create-key.js

# 2. Copy API key và gửi cho khách hàng
```

### Kiểm tra tình trạng keys:
```bash
# Xem tất cả keys
node scripts/list-keys.js
```

### Khi khách hàng hết hạn/hủy dịch vụ:
```bash
# Xóa key
node scripts/delete-key.js ten-key-cu
```

---

## 💡 Tips

1. **Đặt tên key rõ ràng**: Nên dùng format như `khach-ten-thang-nam` để dễ quản lý
2. **Backup keys**: Thường xuyên chạy `list-keys.js` và lưu lại danh sách
3. **Theo dõi IP**: Kiểm tra trường `ips` để phát hiện key bị share
4. **Dọn dẹp**: Định kỳ xóa các key đã hết hạn

---

## 🛠️ Tự Động Hóa (Nâng Cao)

Bạn có thể tích hợp các script này vào:
- Website admin panel
- Telegram bot
- Discord bot
- CRM system

Chỉ cần gọi script với `child_process` trong Node.js hoặc sử dụng trực tiếp Upstash REST API.
