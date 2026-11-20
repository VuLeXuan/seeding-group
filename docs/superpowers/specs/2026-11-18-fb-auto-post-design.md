# FB Auto Post: tự đăng bài vào nhóm, Claude gợi ý trả lời comment

Ngày: 2026-11-18 · Sửa: 2026-11-20 (tool không gửi comment) · Trạng thái: bản sửa 20/11 chờ chủ dự án duyệt

Tài liệu này **thay hướng** của [thiết kế 17/11](2026-11-17-fb-reply-desk-design.md). Bản 17/11 cấm tự đăng, cấm giữ cookie hay profile trình duyệt. Ngày 18/11 chủ dự án đổi hướng: tool phải tự đăng và tự trả lời. Phần hộp lead lấy từ GroupLens trong bản 17/11 chưa làm ở v1 (xem mục 2).

**Sửa ngày 20/11 (chủ dự án):** tool chỉ đăng bài vào các nhóm đã khai báo và lưu link từng bài. Chủ dự án tự mở bài và **tự comment**; tool **không bao giờ gửi comment hay trả lời** lên Facebook. Claude vẫn đọc comment mới và soạn sẵn câu gợi ý để anh chép và dán. Mọi phần về gửi trả lời, giai đoạn 2 và tự gửi bị bỏ.

## 1. Mục đích và lý do

Chủ dự án bán phần cứng AI. Anh muốn một tool trên máy Mac của mình làm được bốn việc:

1. tự đăng bài giới thiệu sản phẩm vào **các nhóm Facebook anh đã tham gia**, bằng **nick cá nhân** (anh không quản lý fanpage nào), và giữ link từng bài để mở lại;
2. đọc comment dưới các bài đó qua ScrapeCreators;
3. để Claude soạn **câu gợi ý** dựa trên **bảng kiến thức** và **tính cách** do anh viết;
4. anh bấm mở bài, chép câu gợi ý (sửa nếu cần) và **tự comment** bằng tay.

Thành công nghĩa là người hỏi dưới bài được trả lời nhanh và đúng, anh không phải tự soạn từng câu, và nick không bị khóa.

## 2. Mục tiêu, không làm, tuyệt đối tránh

**Mục tiêu**
- Đăng bài (chữ và ảnh) vào các nhóm đã chọn, đăng ngay hoặc hẹn giờ.
- Lấy được link bài vừa đăng, hiện trong danh sách bài đã đăng với nút «Mở bài», rồi theo dõi comment qua ScrapeCreators.
- Claude soạn câu gợi ý và phân loại comment.
- Hàng gợi ý trên web với các nút Copy, Mở trên Facebook, Soạn lại, Đã trả lời, Bỏ qua. Chủ dự án tự comment trên Facebook.
- Mọi cài đặt nằm trên web, không có bước nào phải gõ lệnh (theo thói quen của chủ dự án với GroupLens).

**Không làm (v1)**
- Trả lời bài hay comment của người khác. Đây là hộp lead GroupLens trong bản 17/11, để sau.
- Nhiều người dùng, đăng nhập vào tool, phân quyền. Chỉ một người dùng, chạy trên Mac của chủ dự án.
- Nhắn tin Messenger.
- Báo ra ngoài app (Telegram, Zalo, thông báo macOS). Chủ dự án ngày 18/11: báo trên giao diện là đủ.
- Deploy lên cloud.

**Tuyệt đối tránh** (có những thứ này thì coi là hỏng, dù tool chạy được)
- Nhiều nick, antidetect, đổi IP hay fingerprint, hoặc bất cứ thứ gì để né cơ chế phát hiện của Facebook.
- Viết lại một bài thành nhiều biến thể (spin) để né lọc nội dung trùng.
- Câu trả lời làm người đọc tưởng là khách hàng độc lập; khen chéo.
- Tool tự gửi comment hay trả lời lên Facebook, dưới bất kỳ hình thức nào (chủ dự án 20/11).
- Gợi ý trả lời cho comment của chính nick.
- Câu gợi ý có giá hay thông số không có trong bảng kiến thức mà không hiện cảnh báo.
- Test tự động chạm vào Facebook thật.

## 3. Ràng buộc

- **Không có API.** Meta đã bỏ API đăng vào nhóm năm 2024, và nick cá nhân không có API đăng bài. Cách duy nhất là lái Chrome bằng Playwright. Cách này trái điều khoản Meta, nick có thể bị checkpoint hoặc khóa. Chủ dự án đã được báo và chấp nhận (18/11).
- **Cookie Facebook nằm trên ổ máy**, trong thư mục profile Chrome riêng (`.data/chrome-profile`, có trong `.gitignore`). Điều này đảo ngược mục cấm của bản 17/11, chủ dự án chấp nhận. Tool không bao giờ thấy hay lưu mật khẩu: anh tự đăng nhập trong cửa sổ Chrome.
- **ScrapeCreators** chỉ đọc, khoảng 1 credit mỗi lần gọi, và chỉ đọc được nội dung công khai (chưa xác minh với nhóm kín, xem mục 7). Key nằm trong `.env` riêng của fb-reply-desk (`SCRAPECREATORS_API_KEY`, chép từ GroupLens).
- **Claude** được gọi bằng `claude -p` trên máy, model Opus 5.5 (`claude-opus-5-5`), dùng gói claude.ai của chủ dự án, **không dùng API key**. Làm giống `grouplens-dashboard/server/claude-runner.mjs`: tắt tool, tắt MCP, không lưu session.
- Mac phải bật và không ngủ. Cửa sổ Chrome hiện trên màn hình (không chạy headless).
- Không commit hay push khi chưa được bảo.
- Luật Quảng cáo 75/2025/QH15 (hiệu lực 01/01/2026) yêu cầu quảng cáo trên mạng xã hội phải nhận ra được. Vì vậy bài đăng phải ghi rõ người bán (tên shop hoặc công ty).

## 4. Các hướng đã cân nhắc

| Hướng | Đánh đổi | Kết quả |
|---|---|---|
| 1. Duyệt bằng một cú bấm trong ≥ 2 tuần, sau đó mở tự gửi cho câu an toàn | Lúc đầu chủ dự án phải bấm. Bù lại, câu sai không lên nhóm và nhịp gửi giống người | Chọn ngày 18/11, **bỏ ngày 20/11** |
| 2. Tự gửi ngay từ đầu, có bộ lọc | Nhanh nhất, nhưng chưa ai kiểm tra Claude trả lời đúng không | Loại |
| **Claude gợi ý, chủ dự án tự comment** | Anh phải tự dán từng câu. Bù lại, tool không thao tác comment trên nick, ít rủi ro bị khóa hơn, và người luôn đọc câu trước khi lên nhóm | **Chọn** (chủ dự án 20/11) |
| Page API chính thức của Meta | Là cách được hỗ trợ, nhưng chủ dự án không có fanpage | Không áp dụng |
| Đọc comment bằng chính trình duyệt đã đăng nhập | Đọc được nhóm kín và miễn phí, nhưng thêm thao tác tự động trên nick thật | **Dùng cho nhóm kín**. Nick của chủ dự án đã ở trong các nhóm đó (18/11); nhóm công khai vẫn đọc qua ScrapeCreators |

## 5. Những gì đã chốt

Các mục ghi *(Claude chọn)* là đề xuất của Claude, chủ dự án đổi được.

### 5.1 Vị trí và công nghệ
- Thư mục `AI hardware/fb-reply-desk`, dự án độc lập, có `.env` và SQLite riêng.
- Công nghệ giống GroupLens: Node.js ≥ 24, ES modules, `node:sqlite`, HTML/CSS/JS thuần, test bằng `node:test`, không framework.
- Thêm đúng một thư viện: `playwright-core`, dùng Chrome đã cài trên máy qua `chromium.launchPersistentContext(dir, {channel: 'chrome', headless: false})`. *(Claude chọn)*
- Chạy ở `127.0.0.1`, không có đăng nhập vào tool, giống GroupLens. *(Claude chọn)*

### 5.2 Trình duyệt
- Nút "Mở Facebook để đăng nhập" mở cửa sổ Chrome với profile riêng. Chủ dự án tự đăng nhập, kể cả bước 2FA.
- Trước mỗi việc, tool kiểm tra còn đăng nhập không. Nếu bị đăng xuất, gặp checkpoint hay một màn hình lạ: **dừng mọi việc trên Facebook**, chụp màn hình, báo lên đầu trang web, chờ chủ dự án xử lý rồi bấm "Chạy tiếp".
- Mỗi lúc chỉ một việc chạy trên trình duyệt (một hàng đợi tuần tự cho đăng bài và đọc comment nhóm kín). Tool không có việc gửi comment.
- Mọi selector của Facebook gom vào một module. Hỏng selector thì lưu ảnh chụp và HTML của trang, đánh dấu việc đó thất bại, thử lại tối đa một lần.
- Ghi nhật ký mọi thao tác lên Facebook (thời điểm, việc gì, kết quả).

### 5.3 Nhóm
- Chủ dự án dán link nhóm. Tool mở nhóm, lấy tên và xác định nhóm công khai hay kín.
- Mỗi nhóm có ô ghi chú luật nhóm, cờ "nhóm cho đăng bán", và công tắc bật/tắt. Nhóm chưa bật cờ "cho đăng bán" thì không chọn được khi đăng. *(Claude chọn)*

### 5.4 Đăng bài
- Soạn bài trên web: phần chữ, tối đa 10 ảnh, chọn nhóm, đăng ngay hoặc hẹn giờ. *(Claude chọn số ảnh)*
- Nút "Claude viết nháp bài" soạn từ bảng kiến thức và tính cách. Chủ dự án sửa trước khi đăng.
- Đăng **cùng một nội dung** vào mọi nhóm đã chọn, không spin.
- Giới hạn, đặt được trên web: hai lần đăng cách nhau ít nhất 30 phút, tối đa 5 lần đăng mỗi ngày (mỗi nhóm tính một lần). *(Claude chọn mức mặc định)*
- Sau khi bấm Đăng, tool xác định một trong bốn kết quả:
  - **Đã đăng:** lấy link bài.
  - **Chờ admin duyệt:** lưu lại, cứ 30 phút kiểm tra lại, hết 3 ngày thì thôi.
  - **Bị từ chối.**
  - **Lỗi:** kèm ảnh chụp màn hình.
- Link bài lấy ra phải dùng được với ScrapeCreators `/v1/facebook/post/comments`.
- Trang Đăng bài có danh sách bài đã đăng: nhóm, giờ đăng, trạng thái, số comment, nút **«Mở bài»** mở link bài ở tab mới để chủ dự án tự comment. (Chủ dự án 20/11.)

### 5.5 Theo dõi comment
- Gọi `/v1/facebook/post/comments` (tham số `url`, `sort`, `cursor`) và `/v1/facebook/post/comment/replies` (tham số `feedback_id`, `expansion_token`, `cursor`), giống `grouplens-dashboard/server/crawler.mjs`.
- Lịch đọc theo tuổi bài *(Claude chọn, sửa được trên web)*:

  | Tuổi bài | Đọc mỗi | Số lần |
  |---|---|---|
  | 0–1 giờ | 5 phút | 12 |
  | 1–6 giờ | 15 phút | 20 |
  | 6–24 giờ | 1 giờ | 18 |
  | 1–3 ngày | 4 giờ | 12 |

  Tổng khoảng 62 lần gọi mỗi bài, chưa tính trang trả lời con. Sau 3 ngày thì dừng, bật lại tay được.
- Có trần credit mỗi ngày (mặc định 500). Chạm trần thì ngừng đọc và báo trên web. Có nút "Đọc ngay" cho từng bài.
- **Hai cách đọc** (chủ dự án ngày 18/11: nick đã ở trong các nhóm):
  - **Nhóm công khai:** đọc qua ScrapeCreators như trên.
  - **Nhóm kín**, hoặc ScrapeCreators không thấy bài sau 30 phút: đọc bằng chính cửa sổ Chrome đã đăng nhập. Việc đọc đi chung hàng đợi trình duyệt với đăng bài. Lịch đọc thưa hơn: 0–1 giờ 10 phút một lần, 1–6 giờ 30 phút, 6–24 giờ 2 giờ, 1–3 ngày 6 giờ. Tối đa 20 lần mở trang để đọc mỗi giờ. Cách đọc này phải trả về đủ dữ liệu như bảng `comments`, kể cả `author_id`. *(Claude chọn lịch và giới hạn)*
- Cả hai cách đều không đọc được thì đánh dấu "không theo dõi được" và báo. Không thử lặp lại liên tục.
- **Không gợi ý cho comment của chính nick:** bỏ qua mọi comment có `author.id` trùng nick của chủ dự án (lấy sau khi đăng nhập), và mọi comment trùng nội dung một câu anh đã bấm «Đã trả lời». ScrapeCreators có khi trả `author.id` dạng `pfbid…`, khi đó chỉ còn cách so nội dung (bản thử kiểm nick anh hiện ở dạng nào).

### 5.6 Claude soạn trả lời
- **Đầu vào:** bảng kiến thức, tính cách, nội dung bài, comment cần trả lời kèm các comment trước nó trong cùng nhánh, và những câu anh đã bấm «Đã trả lời» trong thread.
- **Đầu ra** là JSON gồm:
  - `reply`: câu trả lời.
  - `category`, một trong: `spec` (hỏi thông số, tính năng), `price_known` (hỏi giá có trong bảng), `price_unknown` (hỏi giá ngoài bảng, xin giảm giá), `order` (muốn mua, chốt đơn, hỏi giao hàng), `support` (bảo hành, lỗi, khiếu nại), `competitor` (so sánh với hãng khác), `no_reply` (tag bạn bè, cảm ơn, spam), `other`.
  - `grounded`: đáp án có nằm trong bảng kiến thức không.
  - `quotes`: các đoạn trích từ bảng kiến thức đã dựa vào.
- **Kiểm tra bằng code, không tin lời Claude:** mọi con số (giá, thông số), link và tên trang trong `reply` phải có trong bảng kiến thức. Không đạt thì thẻ gợi ý hiện cảnh báo «Có số hoặc link không có trong bảng kiến thức: …» để anh sửa trước khi dán.
- **Quy tắc viết:**
  - tiếng Việt, tối đa khoảng 4 câu, xưng hô theo tính cách;
  - không bịa giá hay thông số, thiếu thì nói sẽ kiểm tra và chuyển cho người;
  - không chê đối thủ, không giả làm khách hàng;
  - chỉ đưa số điện thoại hoặc link khi bảng kiến thức có mục "liên hệ được công khai".
- Giới hạn số lần gọi Claude mỗi giờ (mặc định 60).
- Lưu mọi bản nháp (nội dung, model, thời điểm).
- Dòng ghi chú cuối câu: **bỏ** (20/11). Tool không gửi gì, chủ dự án tự quyết ghi gì khi dán.

### 5.7 Hàng gợi ý trả lời (sửa 20/11)
- Trang chính liệt kê comment mới, mỗi thẻ có: nhóm, bài, comment, câu gợi ý (sửa được ngay trên thẻ), loại, cờ `grounded`, cảnh báo số nếu có.
- Các nút trên thẻ:
  - **Copy:** chép câu đang hiện trên thẻ (kể cả phần anh đã sửa) vào clipboard.
  - **Mở trên Facebook:** mở link comment (`?comment_id=…`, trả lời con thì thêm `&reply_comment_id=…`) ở tab mới để anh tự trả lời.
  - **Soạn lại:** nhờ Claude soạn câu khác.
  - **Đã trả lời:** anh đã tự comment xong. Thẻ chuyển sang lịch sử, câu cuối được lưu để nhận ra khi nó xuất hiện trong comment đọc về.
  - **Bỏ qua:** không trả lời comment này.
- Không có giai đoạn, không có tự gửi, không có giới hạn số câu gửi mỗi giờ. Loại `no_reply` (tag bạn bè, cảm ơn, spam) không cần gợi ý: thẻ hiện ở mục «Không cần trả lời» và anh bỏ qua được cả loạt.
- Nút **"Dừng tất cả"** luôn nằm trên đầu trang. Khi dừng: không đăng, không mở Facebook. ScrapeCreators vẫn đọc comment và Claude vẫn soạn gợi ý.
- **Chỉ báo trên giao diện** (chủ dự án ngày 18/11):
  - số câu gợi ý đang chờ hiện trên menu và trên tiêu đề tab;
  - khi tool tự dừng (checkpoint, đăng xuất, chạm trần credit), một dải báo đỏ hiện trên đầu trang;
  - trang tự cập nhật, không cần tải lại.

### 5.8 Kiến thức và tính cách
- Trang "Kiến thức & tính cách" có hai ô soạn markdown, lưu trong DB, có lịch sử phiên bản.
- Mẫu ban đầu có sẵn các mục.
  - **Kiến thức:** sản phẩm, giá, giao hàng, bảo hành, liên hệ được công khai, tên shop hoặc công ty.
  - **Tính cách:** xưng hô, giọng điệu, độ dài, emoji, những điều không bao giờ nói.
- Nút **"Thử"**: dán một comment giả để xem Claude trả lời thế nào, không gửi gì lên Facebook.

### 5.9 Dữ liệu (SQLite)
- `fb_groups(id, url, name, visibility, rules_note, allow_selling, enabled, added_at)`
- `posts(id, text, images, created_at)`: `images` là JSON, ảnh lưu trong `.data/uploads/`.
- `post_targets(id, post_id, group_id, scheduled_at, status, permalink, fb_post_id, posted_at, next_poll_at, error, screenshot)`. `status` nhận: `scheduled`, `posting`, `pending_approval`, `published`, `declined`, `failed`, `untrackable`.
- `comments(id, target_id, parent_id, author_id, author_name, text, created_at, fetched_at, is_own)`
- `replies(id, comment_id, draft, final_text, category, grounded, quotes, status, model, created_at, done_at, error)`. `status` nhận: `waiting` (chờ anh), `done` (anh đã tự trả lời), `skipped`. (Sửa 20/11: bỏ `sending`, `sent`, `failed` và cột `mode`.)
- `settings(key, value)`: kiến thức và tính cách (có phiên bản), các giới hạn đăng bài, trần credit, giới hạn gọi Claude, `author.id` của nick, cờ dừng.
- `events(id, at, kind, detail)`: nhật ký.

### 5.10 Cách triển khai
- Lập kế hoạch và làm theo SpecGate giống GroupLens để giữ nhật ký công việc: subagent làm từng bước, mỗi bước có reviewer. *(Claude chọn)*
- fb-reply-desk cần `git init` trên máy. Không commit khi chưa được bảo.

## 6. Để người triển khai tự quyết
- Selector của Facebook, cách lấy link bài sau khi đăng, cách nhận ra bài đang chờ duyệt.
- Bố cục và màu giao diện (nên giống GroupLens cho quen mắt).
- Prompt chi tiết cho Claude, miễn tuân thủ 5.6.
- Cấu trúc thư mục và cách làm migration.

## 7. Kiểm thử và bản thử đầu tiên
- Test tự động **không chạm Facebook thật**. Logic (lịch đọc, giới hạn, phân loại, kiểm số, bỏ qua comment của chính nick) test bằng `node:test`. Phần trình duyệt test trên trang HTML giả.
- **Bản thử bắt buộc trước khi làm hết.** Dùng nick thật; mỗi thao tác lên Facebook đều hỏi chủ dự án trước. Các bước:
  1. đăng 1 bài vào 1 nhóm công khai do chủ dự án chọn;
  2. lấy link bài;
  3. đọc comment qua ScrapeCreators;
  4. chủ dự án **tự comment bằng tay** 1 câu dưới bài thử; tool đọc về và phải nhận ra đó là comment của chính nick.

  Nếu anh có nhóm kín, làm thêm một bước: đọc comment của một bài trong nhóm kín bằng Chrome, chỉ đọc, không đăng gì.

  Bản thử cần trả lời ba câu hỏi:
  - bài mới đăng bao lâu thì ScrapeCreators thấy;
  - comment có `author.id` không, đọc qua ScrapeCreators và đọc qua Chrome đều phải kiểm;
  - ScrapeCreators có đọc được nhóm kín không.

  Nếu bước nào hỏng, dừng lại, báo chủ dự án, rồi sửa thiết kế trước khi làm tiếp.

  Kết quả ghi vào `docs/superpowers/notes/`.

## 8. Rủi ro đã biết
- **Checkpoint hoặc khóa nick.** Giảm bằng nhịp chậm, một nick, dừng ngay khi gặp màn hình lạ. Không loại bỏ được hẳn.
- **Facebook đổi giao diện** làm hỏng selector. Tool báo lỗi kèm ảnh chụp, người sửa selector.
- **ScrapeCreators** chậm, hoặc không thấy bài mới.
- **Claude gợi ý sai.** Chủ dự án luôn đọc câu trước khi dán; kiểm số bằng code hiện cảnh báo trên thẻ.
- **Nhóm cấm đăng bán.** Chủ dự án tự đọc luật nhóm; tool chỉ giữ ghi chú và cờ.
- **Pháp lý chưa xác minh:** Luật Trí tuệ nhân tạo 134/2025/QH15 (hiệu lực 01/03/2026), điều 11 về minh bạch, có thể buộc ghi rõ câu trả lời do AI viết. Cần người làm pháp lý xem.
