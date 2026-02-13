# BÁO CÁO ĐIỀU TRA: VẤN ĐỀ "NHỚ NGỮ CẢNH KÉM"

**Ngày điều tra:** 2026-02-11
**Team:** context-memory-investigation
**Trạng thái:** Hoàn thành

---

## 🎯 TÓM TẮT ĐIỀU TRA

**Kết luận chính:** Proxy là **STATELESS** - không lưu trữ lịch sử hội thoại. Vấn đề "nhớ ngữ cảnh kém" **KHÔNG PHẢI** do lỗi trong proxy code, mà do:

1. **Client application không gửi đủ conversation history** (nguyên nhân khả dĩ nhất)
2. **Backend API xử lý context không tốt**
3. **System prompt quá dài chiếm tokens**

---

## ✅ ĐÃ XÁC NHẬN KHÔNG PHẢI NGUYÊN NHÂN

### 1. Messages Bị Cắt/Filter (Researcher-2)
**Kết quả:** ✅ KHÔNG CÓ VẤN ĐỀ

- Proxy giữ nguyên 100% messages array từ client → backend
- Không có truncation, filtering, hoặc middleware can thiệp
- Chỉ có system prompt injection (không ảnh hưởng user/assistant messages)
- Smart usage counting phân biệt user messages vs tool results
- Bypass system prompt có sẵn qua `supperapi.store` URLs hoặc profile flag

**File kiểm tra:** `api/proxy.ts`

---

### 2. Proxy Lưu Trữ Conversation Sai (Researcher-1)
**Kết quả:** ✅ KHÔNG CÓ VẤN ĐỀ

**Phát hiện quan trọng:** Proxy hoàn toàn stateless

- Redis chỉ lưu: API keys, settings, profiles, metrics, announcements
- **KHÔNG** lưu conversation history, messages, hoặc chat state
- Client phải gửi full context trong mỗi request
- Đây là kiến trúc chuẩn của OpenAI-compatible proxy

**Redis Schema hiện tại:**
```
api_key:{key_id} → RedisKeyData (expiry, daily_limit, usage)
api_profile:{id} → APIProfile (backend config)
backup_profile:{id} → BackupProfile (fallback config)
model_config:{name} → ModelConfig (system prompts)
settings → Global configuration
concurrency:{profile_id} → Number (concurrent requests)
announcement:{id} → Announcement (system notifications)
metrics:* → Performance metrics
```

**Không có:** `conversation:*`, `chat_history:*`, `messages:*`, `thread:*`

**File kiểm tra:** `lib/redis.ts`, `lib/types.ts`

---

### 3. Session Tracking Issues (Researcher-3)
**Kết quả:** ✅ KHÔNG CÓ VẤN ĐỀ (nhưng có bugs khác)

**Conversation tracking:**
- Correlation ID chỉ dùng cho logging/debugging (per-request)
- Session interface được định nghĩa nhưng **KHÔNG SỬ DỤNG**
- Không có conversation_id, thread_id, hoặc chat_id tracking
- Mỗi request hoàn toàn độc lập
- **KHÔNG có bug nào gây nhầm lẫn conversation data giữa users**

**⚠️ BUG PHÁT HIỆN (không liên quan đến context memory):**

**Bug #1: Correlation ID Storage Không An Toàn** (lib/logger.ts:50-65)
```typescript
const correlationIdStorage = new Map<string, string>();

export function setCorrelationId(id: string): void {
    correlationIdStorage.set('current', id);  // ❌ GLOBAL KEY!
}
```

**Vấn đề:**
- Sử dụng key cố định `'current'` cho TẤT CẢ requests
- Trong môi trường concurrent, requests có thể ghi đè lẫn nhau
- Logs có thể bị gắn sai correlation ID
- **Không ảnh hưởng đến conversation data**, chỉ ảnh hưởng debugging

**Khuyến nghị:** Thay bằng AsyncLocalStorage (như comment trong code đã gợi ý)

**Bug #2: Session Interface Không Được Sử Dụng**
- Interface định nghĩa trong `lib/types.ts:2-11` nhưng không có code nào dùng
- Functions `activateDevice()` và `isDeviceActivated()` đã deprecated
- Khuyến nghị: Xóa code không dùng hoặc implement đúng cách

**File kiểm tra:** `lib/logger.ts`, `lib/types.ts`, `api/proxy.ts`

---

### 4. Context Limits Trong Proxy (Researcher-5)
**Kết quả:** ✅ KHÔNG CÓ VẤN ĐỀ

- Proxy **KHÔNG** có token counting hay truncation logic
- Không có context window validation
- Tất cả parameters (max_tokens, messages, temperature) được forward nguyên vẹn
- Chỉ có 1 giới hạn: System prompt tối đa 10K characters

**Context limits do backend API quyết định:**
- Claude API: ~200K tokens (Opus)
- GPT API: ~128K tokens (GPT-4)
- Gemini API: ~1M+ tokens
- Proxy dựa vào backend để reject oversized requests

**Potential issues:**
1. System prompt overhead (lên đến 10K chars)
2. Sai `model_actual` mapping (trỏ đến model có context nhỏ hơn)
3. Backend API restrictions
4. Backend service configuration limits

**File kiểm tra:** `lib/types.ts`, `api/proxy.ts`

---

### 5. Caching Strategy Impact (Researcher-4)
**Kết quả:** ✅ KHÔNG CÓ VẤN ĐỀ

**LRU Cache chỉ lưu configuration data:**
- API Profiles (60s TTL, max 100 entries)
- Backup Profiles (60s TTL)
- Model Configs (120s TTL)
- Settings (30s TTL, separate cache)

**Không cache:**
- API Keys (luôn fetch fresh từ Redis)
- Session data
- Conversation history (không tồn tại)
- User-specific data

**Potential stale data issues:**
- Profile changes mất 60s để propagate (minor UX issue)
- Settings changes mất 30s để propagate
- **Không ảnh hưởng đến conversation flow**

**Frontend Analysis:**
- `public/admin/app.js`: Admin dashboard, không có chat UI
- `public/user/index.html`: Key status checker, không có chat UI
- **Không có chat client trong codebase này**
- Proxy được thiết kế để dùng với external clients (Cursor, Continue.dev, etc.)

**File kiểm tra:** `lib/redis.ts`, `public/admin/app.js`, `public/user/index.html`

---

## 🎯 NGUYÊN NHÂN KHẢ DĨ

Vì proxy là stateless và không can thiệp vào messages, vấn đề "nhớ ngữ cảnh kém" chỉ có thể do:

### 1. ⚠️ Client Application Không Gửi Đủ Conversation History (Khả năng cao nhất)

**Lý do:**
- Proxy không lưu conversation history
- Client phải gửi full messages array trong mỗi request
- External chat applications (Cursor, TypingMind, Chatbox AI) có thể:
  - Giới hạn số messages gửi đi
  - Truncate conversation history để tiết kiệm tokens
  - Có bugs trong conversation management
  - Không implement context window management đúng cách

**Cách kiểm tra:**
- Log incoming `requestBody.messages` trong `api/proxy.ts`
- Kiểm tra xem client có gửi đủ messages không
- So sánh với conversation history thực tế trong client UI

**Cách khắc phục:**
- Nếu là client của bạn: Fix conversation management logic
- Nếu là third-party client: Không thể fix, chỉ có thể document limitation

---

### 2. Backend API Issues

**Khả năng:**
- Backend không xử lý context tốt
- Model được chọn có context window nhỏ
- Backend service có configuration limits
- Backend API rate limiting hoặc throttling

**Cách kiểm tra:**
- Log backend responses trong `api/proxy.ts`
- Kiểm tra error messages từ backend
- Test trực tiếp với backend API (bypass proxy)

**Cách khắc phục:**
- Chọn model có context window lớn hơn
- Điều chỉnh backend configuration
- Switch sang backend profile khác

---

### 3. System Prompt Quá Dài

**Khả năng:**
- System prompt chiếm quá nhiều tokens (max 10K chars)
- Giảm không gian cho conversation history
- Backend API reject request vì quá dài

**Cách kiểm tra:**
- Kiểm tra system prompt length trong admin panel
- Test với system prompt ngắn hơn
- Monitor backend error responses

**Cách khắc phục:**
- Rút gọn system prompt
- Sử dụng `disable_system_prompt_injection` flag
- Bypass system prompt cho specific profiles

---

## 🔧 KHUYẾN NGHỊ GIẢI PHÁP

### Giải pháp ngắn hạn (Investigation/Debugging):

1. **Thêm logging chi tiết trong api/proxy.ts:**
   ```typescript
   // Log incoming messages count
   console.log(`[PROXY] Received ${requestBody.messages.length} messages from client`);

   // Log first and last message for context
   console.log(`[PROXY] First message:`, requestBody.messages[0]);
   console.log(`[PROXY] Last message:`, requestBody.messages[requestBody.messages.length - 1]);

   // Log system prompt length
   console.log(`[PROXY] System prompt length: ${systemPrompt?.length || 0} chars`);
   ```

2. **Thêm debug endpoint để inspect requests:**
   ```typescript
   // api/debug/last-request.ts
   // Store last N requests in memory for debugging
   ```

3. **Monitor backend responses:**
   - Log error messages từ backend
   - Track context-related errors (token limit exceeded, etc.)

4. **Test với different clients:**
   - Test với curl (gửi manual messages array)
   - Test với different chat applications
   - So sánh kết quả

---

### Giải pháp dài hạn (Optional Features):

**⚠️ LƯU Ý: Chỉ implement nếu thực sự cần thiết**

#### Option 1: Server-Side Conversation Storage (Breaking Change)

**Pros:**
- Client không cần quản lý conversation history
- Proxy có thể optimize context window
- Có thể implement conversation summarization

**Cons:**
- Phá vỡ kiến trúc stateless hiện tại
- Tăng Redis storage costs
- Tăng complexity
- Không tương thích với OpenAI-compatible clients

**Implementation:**
```typescript
// lib/types.ts
export interface Conversation {
    conversation_id: string;
    api_key: string;
    messages: Array<{role: string; content: string}>;
    created_at: number;
    last_activity: number;
}

// Redis schema
conversation:{conversation_id} → Conversation
```

**KHÔNG KHUYẾN NGHỊ** - Phá vỡ compatibility với existing clients

---

#### Option 2: Context Window Management (Recommended)

**Pros:**
- Giữ nguyên stateless architecture
- Tự động truncate old messages khi vượt quá limit
- Transparent cho client

**Cons:**
- Mất context cũ
- Cần implement smart truncation logic

**Implementation:**
```typescript
// api/proxy.ts
function truncateMessages(messages: any[], maxTokens: number): any[] {
    // Keep system message + recent messages
    // Estimate tokens (rough: 1 token ≈ 4 chars)
    // Truncate from middle, keep first and last messages
}
```

**KHUYẾN NGHỊ** - Nếu muốn thêm feature này

---

#### Option 3: Conversation Summarization

**Pros:**
- Giữ context quan trọng
- Giảm token usage
- Improve long conversations

**Cons:**
- Cần call LLM để summarize (cost + latency)
- Có thể mất thông tin quan trọng
- Complex implementation

**KHÔNG KHUYẾN NGHỊ** - Quá phức tạp cho use case này

---

## 📊 KẾT LUẬN

### Findings chính:

1. ✅ **Proxy code KHÔNG có lỗi** về xử lý conversation context
2. ✅ **Messages array được forward nguyên vẹn** từ client → backend
3. ✅ **Không có bugs gây nhầm lẫn data giữa users**
4. ⚠️ **Có bug trong correlation ID tracking** (không ảnh hưởng functionality)
5. 🎯 **Vấn đề "nhớ ngữ cảnh kém" rất có thể do client application**

### Next steps:

1. **Immediate:** Thêm logging để xác định client có gửi đủ messages không
2. **Short-term:** Fix correlation ID bug (AsyncLocalStorage)
3. **Medium-term:** Xóa unused Session interface code
4. **Long-term:** Consider context window management feature (optional)

### Câu hỏi cần trả lời:

1. User đang dùng client application nào? (Cursor, TypingMind, Chatbox AI, custom?)
2. Có thể access logs của client application không?
3. User có thể test với curl để verify proxy behavior không?
4. Backend API nào đang được dùng? (Claude, GPT, Gemini?)

---

**Báo cáo được tạo bởi:** Team context-memory-investigation
**Researchers:** researcher-1, researcher-2, researcher-3, researcher-4, researcher-5
