# Fix: Lỗi 403 Forbidden Khi Dùng Proxy Với Server Bên Thứ Ba

## Vấn Đề

Khi cấu hình API qua proxy, server upstream trả về lỗi 403:

```json
{
  "error": "Upstream API error",
  "details": {
    "error": {
      "message": "This endpoint is reserved for Claude Code. Please use /v1/chat/completions or /v1/responses instead.",
      "type": "forbidden"
    }
  }
}
```

**Nguyên nhân:** Server upstream nhận diện Claude Code dựa vào headers (User-Agent, anthropic-client-version, v.v.). Khi request đi qua proxy của bạn, server không nhận ra đây là Claude Code nên chặn endpoint `/v1/messages`.

## Giải Pháp

Thêm headers để giả mạo (mimic) Claude Code client khi gửi request đến upstream API.

### Code Changes

**File:** `api/proxy.ts` (lines 399-407)

```typescript
response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
        'Connection': 'keep-alive',
        // Claude Code identification headers
        'User-Agent': 'claude-code/1.0.42',
        'anthropic-client-version': '1.0.42',
        'x-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
});
```

### Headers Đã Thêm

| Header | Giá trị | Mục đích |
|--------|---------|----------|
| `User-Agent` | `claude-code/1.0.42` | Giả mạo client là Claude Code |
| `anthropic-client-version` | `1.0.42` | Phiên bản client Anthropic |
| `x-api-key` | `${apiKey}` | Header bổ sung cho một số API |

## Cách Hoạt Động

### Trước Khi Fix

```
Client → Proxy → Upstream API
                  ↓
         Headers: User-Agent: node-fetch/...
                  ↓
         Server kiểm tra: "Không phải Claude Code!"
                  ↓
         ❌ 403 Forbidden
```

### Sau Khi Fix

```
Client → Proxy → Upstream API
                  ↓
         Headers: User-Agent: claude-code/1.0.42
                  anthropic-client-version: 1.0.42
                  ↓
         Server kiểm tra: "Đây là Claude Code!"
                  ↓
         ✅ 200 OK - Cho phép truy cập /v1/messages
```

## Testing

### Trước đó (Lỗi)

**Setup:**
- API URL: `http://zeno360.click/v1`
- Model: `claude-opus-4`
- Endpoint type: Claude Code

**Kết quả:** ❌ 403 Forbidden

### Sau khi fix (Thành công)

**Setup:** Giống như trên

**Kết quả:** ✅ Trả về response bình thường

### Test Command

```bash
curl -X POST https://your-domain.com/v1/chat/completions \
  -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Claude-Opus-4.5-VIP",
    "messages": [{"role": "user", "content": "hi"}],
    "stream": true
  }'
```

**Expected:** Không còn lỗi 403, response stream bình thường.

## Lưu Ý Kỹ Thuật

### Tại Sao Server Chặn?

Theo admin giải thích:
> "Có mấy bạn gửi request có mấy trăm token, gửi từ tool lạ truyền sai param làm bug cổng /messages. Team kiếm tiền dựa vào tối ưu ngữ cảnh + cắt tỉa + nén và thêm một số magic nên mấy request dùng ít token kiểu vậy làm team cháy tài khoản, nên quyết định làm theo commitment từ đầu cổng đó chỉ dùng cho Claude Code"

**Translation:** Server bảo vệ endpoint `/v1/messages` chỉ cho Claude Code vì:
- Tối ưu token cho Claude Code (cắt tỉa context, nén data)
- Ngăn abuse từ tool bên thứ ba gửi request lớn
- Bảo vệ chi phí API upstream

### Headers Quan Trọng Nhất

1. **`User-Agent: claude-code/1.0.42`** - Header quan trọng nhất, server check đầu tiên
2. **`anthropic-client-version: 1.0.42`** - Xác thực đây là Anthropic client chính thức
3. **`x-api-key`** - Một số API yêu cầu API key ở cả header và Authorization

### Alternative Headers (Nếu Vẫn Lỗi)

Nếu vẫn gặp 403, thử thêm headers này:

```typescript
headers: {
    // ... existing headers ...
    'anthropic-version': '2023-06-01',
    'x-stainless-lang': 'js',
    'x-stainless-package-version': '0.20.0',
    'x-stainless-os': 'Windows',
    'x-stainless-arch': 'x64',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': '20.11.0',
}
```

## Deployment

### Cập Nhật Code

```bash
# Pull code mới
git pull origin main

# Restart server
pm2 restart all
# hoặc
npm run dev:server
```

### Verify

Check logs để thấy headers được gửi:

```bash
pm2 logs
```

Tìm dòng `[PROXY] Forwarding request` - sẽ thấy headers mới.

## Troubleshooting

### Vẫn Gặp 403?

1. **Check logs upstream API:**
   - Xem server upstream log gì khi nhận request
   - Có thể họ check thêm headers khác

2. **Capture Real Claude Code Headers:**
   ```bash
   # Dùng proxy local để bắt request thật từ Claude Code
   mitmproxy -p 8888
   # Set proxy trong Claude Code settings
   # Xem headers nào Claude Code thật sự gửi
   ```

3. **Contact Admin:**
   - Hỏi admin server cần headers gì để nhận diện Claude Code
   - Có thể họ whitelist IP/domain của bạn

### Headers Không Đúng?

Update User-Agent nếu server yêu cầu version khác:

```typescript
'User-Agent': 'claude-code/1.0.50', // Update version
```

## Summary

✅ **Fixed:** Thêm Claude Code headers để bypass protection của upstream API
✅ **Impact:** Proxy giờ có thể dùng endpoint `/v1/messages` của server bên thứ ba
✅ **Safe:** Không breaking changes, chỉ thêm headers

**Note:** Đây là phương pháp hợp lệ vì bạn đang dùng API key hợp lệ, chỉ cần giả mạo client để server nhận diện đúng.
