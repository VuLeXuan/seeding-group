# FB Reply Desk — thiết kế

Ngày: 2026-11-17 · Trạng thái: chờ chủ dự án duyệt

## 1. Mục đích và lý do

Công ty bán phần cứng AI muốn có mặt trong các thảo luận Facebook nơi người dùng đang hỏi mua đúng loại sản phẩm của mình, và trả lời nhanh, đúng, có ích. GroupLens (`../grouplens-dashboard`) đã crawl được các nhóm công khai và đánh dấu bài/comment có tín hiệu hỏi mua (`demand`/`buying`), nhưng không có chỗ để đội ngũ xử lý những lead đó.

FB Reply Desk là một "bàn trả lời" cho nhân viên:

1. lấy lead từ GroupLens,
2. AI soạn nháp câu trả lời dựa trên thông tin sản phẩm,
3. nhân viên sửa nháp rồi **tự đăng bằng tài khoản Facebook thật của mình, có ghi rõ là người của công ty**,
4. tool ghi lại ai đã trả lời, lúc nào, và báo khi thread có hoạt động mới.

Khối lượng hiện tại: một nhóm (Xiaozhi VN), khoảng 10 lead trong 1,5 ngày dữ liệu. Ưu tiên là tốc độ và chất lượng câu trả lời, không phải số lượng.

## 2. Mục tiêu, không làm, tuyệt đối tránh

**Mục tiêu**
- Đăng nhập riêng cho từng nhân viên; có vai trò admin và nhân viên.
- Hộp lead: lead mới nhất ở trên, có link thẳng tới đúng bài hoặc comment, có ngữ cảnh bài gốc.
- AI soạn nháp tiếng Việt từ bảng thông tin sản phẩm; nhân viên sửa được.
- Trạng thái lead: Mới → Đã trả lời / Bỏ qua; có người nhận xử lý để hai người không trả lời trùng.
- Theo dõi thread sau khi trả lời.

**Không làm (v1)**
- Đăng tự động lên Facebook dưới mọi hình thức.
- Trả lời comment trên Page công ty qua Graph API (để sau, nếu cần).
- Deploy cloud (v1 chạy local; xem mục 6).
- Thống kê, báo cáo hiệu quả.

**Tuyệt đối tránh** (nếu tool có những thứ này thì coi là thất bại dù chạy được)
- Lưu mật khẩu, cookie, token đăng nhập Facebook của bất kỳ ai.
- Quản lý nhiều nick, profile trình duyệt, antidetect.
- Câu trả lời làm người đọc tưởng là khách hàng độc lập (không ghi danh tính, giả review, khen chéo).

## 3. Ràng buộc

- ScrapeCreators chỉ đọc; Meta không còn API đăng vào group cho ứng dụng bên ngoài → việc đăng luôn do người làm.
- GroupLens không có đăng nhập và có bản deploy công khai → không đặt AI key, bản nháp hay danh sách lead dạng thô trong GroupLens.
- GroupLens cam kết "không có chức năng đăng bài, seeding hoặc trả lời Facebook" (README) → giữ nguyên; Reply Desk chỉ đọc lead từ GroupLens.
- GroupLens không lưu tên/ID người viết (có chủ đích) → Reply Desk không biết comment nào là của nhân viên mình.
- Chủ dự án yêu cầu: không commit/push khi chưa được bảo.
- Một phiên làm việc khác (Codex) cũng có thể đang sửa GroupLens → thay đổi bên GroupLens giữ nhỏ, báo trước file sẽ sửa.

## 4. Các hướng đã cân nhắc

| Hướng | Đánh đổi | Kết quả |
|---|---|---|
| **A. App riêng, có đăng nhập, người đăng tay** | Thêm một app để chạy; cần một endpoint đọc lead trong GroupLens | **Chọn** (chủ dự án chọn "số 1") |
| B. Thêm vào GroupLens | Ít code hơn, nhưng GroupLens không có đăng nhập: ai cũng dùng ké AI key, đọc được nháp và lead; phá cam kết chỉ-đọc | Loại |
| C. Tool giữ tài khoản Facebook và tự đăng/comment | Trái mục "tuyệt đối tránh", rủi ro khóa tài khoản | Từ chối |

## 5. Những gì đã chốt

### 5.1 Vị trí và công nghệ
- Thư mục: `AI hardware/fb-reply-desk`, dự án độc lập (package.json riêng, `.env` riêng, database riêng).
- Cùng kiểu với GroupLens cho dễ bảo trì: Node.js ≥ 24, ES modules, `node:sqlite`, HTML/CSS/JS thuần, test bằng `node:test`. Không dùng framework.
- Gọi AI bằng SDK chính thức `@anthropic-ai/sdk` (lựa chọn của Claude, chủ dự án có thể đổi).

### 5.2 Đăng nhập và quyền
- Email + mật khẩu; mật khẩu băm bằng `crypto.scrypt` có salt.
- Phiên: token ngẫu nhiên 32 byte, chỉ lưu SHA-256 trong DB; cookie `HttpOnly; SameSite=Strict` (thêm `Secure` khi chạy https); hết hạn sau 7 ngày.
- Giới hạn đăng nhập sai theo IP + email; kiểm tra Origin với mọi request ghi.
- Vai trò: `admin` (quản lý người dùng, bảng thông tin sản phẩm, cài đặt) và `staff` (xử lý lead).
- Admin đầu tiên tạo bằng lệnh `npm run create-admin` (nhập email, tên, mật khẩu ở terminal). Sau đó admin thêm, khóa, đặt lại mật khẩu nhân viên trong giao diện.
- Mỗi người dùng có **chữ ký công khai** (ví dụ "— Vũ, bên [tên công ty]"), bắt buộc, dùng ở cuối mọi bản nháp.

### 5.3 Nguồn lead: endpoint mới trong GroupLens
`GET /api/leads?since=<ISO>&limit=<n>`

- Xác thực bằng `Authorization: Bearer <LEADS_TOKEN>` (biến mới trong `.env` của GroupLens, cùng kiểu `SCHEDULER_TOKEN`). Không đặt token → endpoint tắt (404).
- Trả về bài/comment từ nguồn đang bật, có `analysis.demand` hoặc `analysis.buying` và không phải `analysis.seller`, `published_at >= since`, mới nhất trước, tối đa `limit` (mặc định 200, trần 500).
- Mỗi lead gồm: `id`, `kind` (post/comment), `text` (đã che số điện thoại/email như báo cáo hiện tại), `url` (link thẳng, xem dưới), `postId`, `parentId`, `postText` (500 ký tự đầu của bài gốc), `sourceName`, `publishedAt`, `replyCount`, `thread: {comments, lastActivityAt}` (số comment và thời điểm comment mới nhất trong cùng bài).
- **Link thẳng tới comment**: ID comment đã lưu là base64 của `comment:<postId>_<commentId>`. Comment cấp 1 → `<post permalink>?comment_id=<commentId>`; reply → `?comment_id=<parentCommentId>&reply_comment_id=<commentId>`. Không giải mã được thì dùng link bài.

### 5.4 Đồng bộ
- Reply Desk tự gọi `/api/leads` mỗi 10 phút (đặt được trong `.env`) và có nút "Đồng bộ ngay".
- Upsert theo `id`; không bao giờ ghi đè các trường xử lý (trạng thái, người nhận, nội dung đã trả lời).
- Lần đầu lấy 7 ngày gần nhất.
- GroupLens không chạy hoặc sai token → hiện lỗi đồng bộ trên giao diện, dữ liệu cũ vẫn dùng được.

### 5.5 Hộp lead
- Danh sách: nội dung lead, ngữ cảnh bài gốc (thu gọn), nguồn, thời gian ("2 giờ trước"), trạng thái, người đang xử lý.
- Lọc theo trạng thái (Mới / Đang xử lý / Đã trả lời / Bỏ qua) và theo nguồn; mặc định hiện lead Mới.
- Mở một lead → **nhận xử lý**: ghi `assigned_to` + thời điểm; người khác thấy "X đang xử lý". Nhận xử lý hết hạn sau 30 phút không hoạt động.
- Hành động: "Mở trên Facebook" (link thẳng), "Soạn nháp bằng AI", "Đã trả lời", "Bỏ qua" (kèm lý do ngắn, tuỳ chọn).

### 5.6 Soạn nháp bằng AI
- Dùng Claude qua `ANTHROPIC_API_KEY` trong `.env` của Reply Desk; model đặt bằng `ANTHROPIC_MODEL` (mặc định chọn lúc triển khai theo tài liệu Claude API mới nhất).
- Không có key → ẩn nút soạn nháp, nhân viên tự viết.
- Đầu vào: bảng thông tin sản phẩm (admin soạn, dạng văn bản), nội dung lead, ngữ cảnh bài gốc, chữ ký của người dùng.
- Quy tắc cho AI: tiếng Việt, tự nhiên, tối đa khoảng 4 câu; trả lời đúng câu hỏi; chỉ dùng thông số/giá có trong bảng thông tin, không có thì nói sẽ kiểm tra; không chê đối thủ; **không bao giờ tự nhận là khách hàng hay người dùng độc lập**; luôn kết bằng chữ ký công khai.
- Giới hạn số lần soạn mỗi người mỗi giờ (mặc định 60) để chặn chi phí.
- Lưu mọi bản nháp (người, thời điểm, model) để xem lại.

### 5.7 Đánh dấu đã trả lời và theo dõi
- "Đã trả lời" mở form: nội dung đã đăng (điền sẵn bản nháp cuối) + ô xác nhận bắt buộc "Tôi đã đăng từ tài khoản Facebook thật của mình và ghi rõ là người của công ty".
- **Một lead có thể được trả lời nhiều lần** (quyết định của Claude, sau bước review): mỗi lần là một dòng trong bảng `replies`; lead đã trả lời có nút "Trả lời thêm".
- Theo dõi: mỗi lần đồng bộ, so `thread.lastActivityAt` với lần trả lời **gần nhất**; hiện "N comment mới trong thread kể từ lần trả lời gần nhất". Vì không có tác giả, con số này **có thể gồm chính câu trả lời của mình**. Giao diện ghi rõ điều đó, nhân viên tự đánh giá.
- **Thông báo chỉ trong app ở v1** (quyết định của Claude): số đếm lead mới và thread có hoạt động mới trên menu và tiêu đề tab, cùng bộ lọc "Có hoạt động mới". Gửi qua email/Zalo/Telegram để sau.

### 5.8 Dữ liệu (SQLite của Reply Desk)
- `users(id, email UNIQUE, name, role, password_hash, signature, disabled, created_at)`
- `sessions(token_hash PK, user_id, expires_at, created_at)`
- `login_attempts(key PK, attempts, reset_at)`
- `leads(id PK, kind, text, url, post_id, parent_id, post_text, source_name, published_at, first_seen_at, last_synced_at, reply_count, thread_comments, thread_last_activity_at, status, assigned_to, assigned_at, last_replied_at, skip_reason)`
- `replies(id, lead_id, user_id, channel, text, created_at)`
- `drafts(id, lead_id, user_id, text, model, created_at)`
- `settings(key PK, value JSON)`: `product_sheet`, `company_name`, `last_sync`, `sync_error`

## 5.9 Câu hỏi còn mở (chưa chốt, xem README)
- Có cho kéo khách sang nhắn riêng, hoặc để link / số điện thoại trong câu trả lời không? Nếu có: thêm cột `channel` (comment/messenger) vào form "Đã trả lời" và quy tắc mời inbox cho AI. Nếu không: AI không bao giờ mời inbox.
- Ai dùng, từ máy nào (một người local, nhiều người qua LAN, hay deploy)?
- Dịch vụ AI soạn nháp (đang chọn Claude).

## 6. Để người triển khai tự quyết
- Bố cục, màu sắc giao diện (nên giống GroupLens cho quen mắt).
- Cổng chạy (đề xuất `127.0.0.1:4180`) và cách cho máy khác trong mạng LAN truy cập (`HOST` trong `.env`).
- Cấu trúc thư mục, tên file, cách tổ chức migration (đề xuất giống GroupLens: `drizzle/` + journal).
- Chi tiết prompt cho AI, miễn tuân thủ quy tắc ở 5.6.
- Cách hiện thời gian tương đối, phân trang danh sách.

## 7. Rủi ro và giới hạn đã biết
- Phân loại "hỏi mua" của GroupLens chỉ dựa trên quy tắc chữ, sẽ có lead sai → nhân viên bấm "Bỏ qua". Trong 10 lead hiện có, ít nhất 3 lead sai (2 người đang bán, 1 người hỏi lập trình).
- Lịch crawl của GroupLens đang tắt (chưa từng lưu lịch) và lượt crawl duy nhất đang dừng → muốn có lead mới phải bật lịch trong GroupLens; mỗi ngày sẽ tốn credit.
- GroupLens crawl theo lịch ngày; câu hỏi mua có thể "nguội" sau vài giờ. Crawl thường hơn tốn thêm credit (không còn trần credit).
- Nhiều nhóm cấm quảng bá: nhân viên cần đọc luật nhóm, nên xin phép admin nhóm.
- Pháp lý (chưa xác minh, cần người làm pháp lý xem): quy định quảng cáo, cạnh tranh, bảo vệ người tiêu dùng có thể áp dụng cho việc giới thiệu sản phẩm mà không công khai danh tính.
