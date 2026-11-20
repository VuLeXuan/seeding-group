# FB Reply Desk

Trạng thái: **mới có thiết kế, chưa có code.** Thiết kế chi tiết: [docs/superpowers/specs/2026-11-17-fb-reply-desk-design.md](docs/superpowers/specs/2026-11-17-fb-reply-desk-design.md).

## Nói ngắn gọn

GroupLens (`../grouplens-dashboard`) đã đọc được các nhóm Facebook công khai và nhận ra ai đang **hỏi mua** (ví dụ: "Mình cần tìm 1 e robot AI có thể kết nối internet bằng Sim 4G"). Nhưng GroupLens chỉ để xem, chưa có chỗ để đội ngũ **trả lời** những người đó.

FB Reply Desk là công cụ nội bộ giúp nhân viên trả lời các câu hỏi ấy **nhanh và đúng**:

```
GroupLens tìm người hỏi mua
        │
        ▼
Reply Desk hiện danh sách "lead" (mới nhất ở trên)
        │
        ▼
AI soạn nháp câu trả lời từ thông tin sản phẩm
        │
        ▼
Nhân viên sửa nháp → tự đăng bằng Facebook thật của mình,
ghi rõ "mình bên [công ty]"
        │
        ▼
Bấm "Đã trả lời" → tool ghi ai trả lời, lúc nào,
và báo khi có người comment tiếp trong thread
```

Tool **không tự đăng gì lên Facebook** và **không giữ tài khoản Facebook** nào.

## Màn hình chính (phác thảo)

```
┌──────────────────────────────────────────────────────────────┐
│ FB Reply Desk                          Vũ (nhân viên) · Thoát │
├───────────────┬──────────────────────────────────────────────┤
│ Lead mới   (4)│ [Mới] [Đang xử lý] [Đã trả lời] [Bỏ qua]     │
│ Hoạt động mới │                                              │
│   (1)         │ ● 2 giờ trước · Xiaozhi VN · comment         │
│ Sản phẩm      │   "Mình cần tìm 1 e robot AI có thể kết nối  │
│ Người dùng    │    internet bằng Sim 4G"                     │
│ (admin)       │   Bài gốc: "Có ai làm robot AI chạy…"        │
│               │   [Mở trên Facebook] [Soạn nháp AI]          │
│               │   [Đã trả lời] [Bỏ qua]                      │
│               │ ──────────────────────────────────────────── │
│               │ ● 5 giờ trước · Xiaozhi VN · bài viết        │
│               │   "Tp hcm em muốn mua linh kiện để về tự     │
│               │    ráp ạ"            Đang xử lý: Lan         │
└───────────────┴──────────────────────────────────────────────┘
```

## Làm gì / không làm gì

| Có | Không |
|---|---|
| Đăng nhập riêng cho từng nhân viên (admin / nhân viên) | Lưu mật khẩu, cookie, tài khoản Facebook |
| Danh sách lead có link thẳng tới đúng bài/comment | Tự đăng bài, tự comment, quản lý nhiều nick |
| AI soạn nháp tiếng Việt, luôn kèm chữ ký công khai của nhân viên | Câu trả lời giả làm khách hàng độc lập |
| Nhận xử lý để hai người không trả lời trùng | Deploy cloud (bản đầu chạy trên máy) |
| Ghi lại các lần trả lời, báo thread có comment mới | Báo qua Zalo/Telegram/email (để sau) |

## Liên quan tới GroupLens

- Reply Desk là **dự án riêng**: code, `.env` và database riêng. Lý do: GroupLens không có đăng nhập và có bản công khai, nên không để AI key, bản nháp hay danh sách lead ở đó.
- GroupLens cần thêm **một** endpoint chỉ đọc: `GET /api/leads`, có token `LEADS_TOKEN`. Đặc tả ở mục 5.3 của tài liệu thiết kế.
- Muốn có lead mới thì GroupLens phải crawl đều. Hiện lịch crawl của GroupLens **đang tắt** và lượt crawl duy nhất đang dừng; bật lịch thì mỗi ngày tốn credit ScrapeCreators.

## Câu hỏi còn mở (cần chốt trước khi lập kế hoạch)

1. **Có cho kéo khách sang nhắn riêng, hoặc để link / số điện thoại trong câu trả lời không?** Vài người hỏi đã xin "A nào có nhắn em", "ib call". Nhưng nhiều nhóm cấm việc này, và GroupLens coi "ib/inbox/link mua" là dấu hiệu bài chào bán. Câu trả lời quyết định quy tắc viết nháp của AI và form "Đã trả lời" có cần ô chọn kênh (Comment / Messenger) hay không. Đề xuất của Claude: chỉ mời inbox khi người hỏi xin hoặc cần báo giá; không để link hay số điện thoại trong comment công khai.
2. **Ai dùng tool, từ đâu?** Nếu chỉ một người trên máy này thì chạy `127.0.0.1` là đủ. Nếu nhiều nhân viên trên máy khác thì cần mở trong mạng LAN hoặc deploy, kéo theo yêu cầu bảo mật khác.
3. **Dịch vụ AI soạn nháp:** thiết kế đang chọn Claude (`ANTHROPIC_API_KEY`). Đổi được nếu công ty đã dùng dịch vụ khác.

## Ghi chú cho phiên lập kế hoạch

- Đọc tài liệu thiết kế trước. Các mục "Tuyệt đối tránh" (mục 2) là ràng buộc cứng, không phải gợi ý.
- Công nghệ theo GroupLens cho dễ bảo trì: Node.js ≥ 24, `node:sqlite`, HTML/CSS/JS thuần, test bằng `node:test`.
- Sửa GroupLens thì giữ thay đổi nhỏ (chỉ thêm `/api/leads`), vì phiên khác có thể đang sửa repo đó.
- Không commit hay push khi chưa được chủ dự án bảo.
