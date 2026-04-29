# Cú Búng Poker

Website **poker online realtime** chơi giải trí với tiền ảo đơn vị **“cú búng”**.
Không tiền thật, không nạp/rút.

> 1 búng = 1 đơn vị cược · 1 gõ = 10 búng · 1 đấm = 100 búng

## Tính năng

- **Texas Hold’em** 2 lá riêng + 5 lá chung, không đổi bài, showdown cuối ván.
- **Realtime** với Socket.IO (người chơi quanh bàn, chat, voice).
- **Logic server-side** chống gian lận: server trộn bài, chia bài, xử lý lượt cược, tính pot, chọn người thắng. Client chỉ hiển thị và gửi action.
- **Vòng cược 15 giây/lượt**; hết giờ tự `check` nếu được, ngược lại `fold`.
- **Đặt cược nhanh** với 3 nút cú búng:
  - **+1 Búng** · **+10 Gõ** · **+100 Đấm**
  - Ngoài ra có input số búng thủ công.
- **Hành động**: Check · Bet · Call · Raise · Fold · All-in.
- **Phòng**: tạo phòng / vào bằng mã phòng 5 ký tự, chủ phòng bấm bắt đầu ván.
- **Trạng thái người chơi**: Đang chờ · Đang chơi · Fold · All-in · Thắng · Thua.
- **Hiệu ứng**:
  - Chia bài bay xuống (community + hole).
  - Trộn bài + intro căng thẳng trước lá thứ 5.
  - Lá cuối **“đập”** xuống bàn.
  - Showdown lật bài từng người một theo thứ tự.
  - Banner công bố người thắng.
- **Chat** text realtime trong phòng.
- **Voice chat** WebRTC (mesh, STUN công cộng), nút bật/tắt mic, icon mic và
  hiệu ứng sáng xanh khi đang nói.
- **Responsive** desktop & mobile.

## Cấu trúc thư mục

```
poker/
├── package.json          # monorepo workspace (server + client)
├── server/               # Node.js + Express + Socket.IO
│   └── src/
│       ├── index.js      # HTTP + Socket.IO entry
│       └── game/
│           ├── deck.js       # tạo + trộn bộ bài
│           ├── evaluator.js  # đánh giá bộ bài 7-lá (best-of-5)
│           ├── pot.js        # side pots + split pot
│           └── room.js       # state machine ván bài (preflop → showdown)
│       └── game/evaluator.test.js  # unit tests cho evaluator
└── client/               # React + Vite
    ├── index.html
    └── src/
        ├── App.jsx              # điều hướng lobby ↔ table
        ├── socket.js            # kết nối Socket.IO
        ├── pages/Lobby.jsx      # nhập tên, tạo/vào phòng
        ├── pages/Table.jsx      # bàn poker + bet bar + chat + voice
        ├── components/
        │   ├── Card.jsx
        │   ├── Seat.jsx
        │   ├── BetBar.jsx
        │   ├── ChatPanel.jsx
        │   ├── WinnerBanner.jsx
        │   └── RiverIntro.jsx
        ├── hooks/
        │   ├── useActionCountdown.js
        │   └── useVoiceChat.js  # WebRTC mesh + speaking detection
        └── styles/index.css
```

## Chạy local

Yêu cầu: **Node.js ≥ 20**.

```bash
cd poker
npm install          # cài cho cả server + client (workspaces)
npm run dev          # chạy song song server (port 3001) + client (port 5173)
```

Mở trình duyệt tại <http://localhost:5173>. Mở nhiều tab để test nhiều người chơi.

Nếu muốn chạy riêng lẻ:

```bash
npm run dev:server   # chỉ server
npm run dev:client   # chỉ client
npm test             # chạy unit tests poker evaluator
npm run build        # build client ra dist/
```

### Biến môi trường

| Biến                  | Mặc định                 | Dùng ở  | Ý nghĩa                          |
| --------------------- | ------------------------ | ------- | -------------------------------- |
| `PORT`                | `3001`                   | server  | Port HTTP/Socket.IO              |
| `CLIENT_ORIGIN`       | `*`                      | server  | CORS origin (đặt chặt lúc deploy)|
| `VITE_SERVER_URL`     | `http://localhost:3001`  | client  | URL server Socket.IO             |

Ví dụ khi deploy client riêng:

```bash
VITE_SERVER_URL=https://poker-api.example.com npm run build
```

## Hướng dẫn chơi nhanh

1. Mở <http://localhost:5173>, nhập tên → **Tạo phòng mới**. Mã phòng hiện ở thanh trên.
2. Bạn bè mở cùng URL, nhập tên → **Vào bằng mã phòng** → nhập mã.
3. Chủ phòng bấm **Bắt đầu ván**.
4. Mỗi người có 1000 búng sẵn. Blind: 5 / 10.
5. Mỗi vòng cược có **15 giây**: dùng **+1 Búng / +10 Gõ / +100 Đấm** rồi bấm
   **Bet / Raise**, hoặc **Check / Call / Fold / All-in**.
6. Trước lá thứ 5 có hiệu ứng trộn bài + intro. Lá cuối rơi xuống bàn.
7. Showdown: bài của từng người lần lượt được lật. Hệ thống xác định người thắng và trao pot.

## Logic poker (tóm tắt)

- `deck.js`: bộ 52 lá chuẩn, Fisher-Yates shuffle.
- `evaluator.js`: đánh giá 7 lá, chọn best-of-5 theo 9 hạng bài
  (straight flush → high card), có xử lý **wheel** A-2-3-4-5.
- `pot.js`: xây **side pot** cho người all-in, chia đều khi hoà (dư chip đi cho người đầu).
- `room.js`: state machine `preflop → flop → turn → river_intro → river → showdown → finished`,
  quản lý blinds, lượt đi, time-out, bet/raise validation, auto-check/fold khi hết giờ.

## Công bằng & fair-play

- Server là nguồn sự thật duy nhất. Client chỉ nhận thông tin **hole card của chính mình** qua
  sự kiện riêng `your_hole`. Bài người khác không được gửi đi cho đến showdown.
- Không có đăng nhập phức tạp — chỉ tên hiển thị. Không lưu database, dữ liệu phòng lưu in-memory.

## Ghi chú mở rộng

- Muốn thêm DB (Redis…) để scale: thay `rooms` Map trong `server/src/index.js`.
- Voice chat đang dùng mesh (P2P) + STUN Google công cộng; với phòng > 6-7 người nên dùng SFU.
- Có thể thêm animations cược bằng chip vật lý hơn, leaderboard, rebuy, tournament format.
