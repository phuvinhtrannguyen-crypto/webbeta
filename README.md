# ExamHub — Nền tảng thi & luyện đề thông minh

Một file `index.html` duy nhất. Vanilla JS + Firebase (modular CDN) + Gemini.  
Không cần build, không cần backend riêng — chỉ cần hosting tĩnh + 1 project Firebase.

## Tính năng

- **3 trang / 3 vai trò**: Admin · Giáo viên · Học sinh (+ Phó admin)
- **Admin** (`phuvinhtrannguyen@gmail.com`): duyệt đề, tạo **Key giáo viên**, quản lý tài khoản, cấp **Phó admin**, khoá/xoá tài khoản, nhập **Google Gemini API key** (giấu cho toàn hệ thống), nút **“Điền tất cả”** chỉ hiện với admin/phó admin trên trang làm bài.
- **Giáo viên**: tạo lớp + tạo sẵn tài khoản học sinh, tạo đề thi / đề luyện thủ công, **tự động tạo đề bằng Gemini** (từ tài liệu + yêu cầu + file đáp án), **đề đục lỗ từ dấu `........`**, chấm điểm gồm cả **fuzzy match** (sai nhưng gần đúng vẫn được 1 phần điểm), tạo link chia sẻ kèm **QR code**, cấu hình **chống gian lận** (fullscreen + khoá copy/paste + đếm lần thoát). Thống kê điểm / lần làm / lần thoát, xuất **CSV**, biểu đồ phân bố điểm.
- **Học sinh**: vào qua link `#join/<examId>` (nhập tên) hoặc đăng nhập bằng tài khoản. Trang làm bài **buộc fullscreen**, khoá copy/paste, đếm số lần thoát màn hình, khoá bài sau khi vượt ngưỡng; giáo viên có thể mở khoá.
- **UX**: giao diện glassmorphism tối, chế độ sáng, command palette `Ctrl+K`, phím tắt `Ctrl+/`, toast, modal, responsive.

## Cài đặt

1. Tạo project Firebase → bật **Authentication** (Email/Password + Google) và **Firestore**.
2. Thêm tài khoản `phuvinhtrannguyen@gmail.com` vào Authentication (đăng ký trên trang đăng nhập hoặc tạo trong Firebase console).
3. Sửa block `FIREBASE_CONFIG` đầu file `index.html` bằng cấu hình thực của bạn:
   ```js
   const FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "project.firebaseapp.com",
     projectId: "project",
     ...
   };
   ```
   (Hoặc định nghĩa `window.FIREBASE_CONFIG = {...}` trước khi nạp file.)
4. Paste Firestore rules từ `firestore.rules` vào Firebase console → Firestore → Rules.
5. Mở `index.html` — xong.

### Nhập Google Gemini API key
Đăng nhập admin → tab **API & cài đặt** → dán API key lấy từ https://aistudio.google.com/app/apikey. Key lưu trong `global/settings` của Firestore, chỉ admin/giáo viên đọc được (tuỳ rules).

### Tạo key giáo viên
Admin → tab **Key giáo viên** → nút **Tạo key mới**. Gửi key cho giáo viên. Giáo viên đăng ký tài khoản bình thường rồi vào trang cá nhân để nhập key → được nâng quyền.

### Tạo đề bằng AI
Tab **Tạo đề bằng AI** → dán tài liệu (hoặc upload .txt) + yêu cầu → AI trả về câu hỏi theo schema, mở editor để bạn sửa & lưu.

### Đề đục lỗ (`........`)
Dán đoạn văn có `........` → nhập đáp án mỗi dòng một từ theo thứ tự → hệ thống tạo đề điền khuyết tự động. Chấm dùng fuzzy match (đáp án gần đúng vẫn có điểm).

## Schema Firestore

Xem `firestore.rules`. Collections:
- `users/{uid}` — `{email,displayName,role,status,createdAt,lastLogin,redeemedKey?}`
- `teacherKeys/{code}` — `{code,usedBy,usedAt,createdAt,createdBy,note,expiresAt?}`
- `classes/{id}` — `{name,description,teacherId,teacherEmail,studentCount}`
- `students/{id}` — `{name,email,code,classId,className,teacherId}`
- `exams/{id}` — `{title,description,type,duration,classId,questions[],antiCheat,requireFullscreen,blockCopy,requireLogin,maxViolations,teacherId,teacherEmail,status,locked}`
- `submissions/{id}` — `{examId,teacherId,studentId,studentName,answers,grading,score,correctCount,total,violations,submittedAt,attemptNo}`
- `events/{id}` — `{type:"violation",reason,examId,examTitle,teacherId,studentId,studentName,count,createdAt}`
- `global/settings` — `{geminiApiKey}`

## Phím tắt

- `Ctrl/Cmd + K` — Command palette
- `Ctrl/Cmd + /` — Danh sách phím tắt
- `Esc` — Đóng modal

## Ghi chú

- Backend riêng (nếu cần): bạn có thể tự thêm Cloud Functions / Node để gọi Gemini server-side thay vì từ client.
- Tính năng “chống gian lận” đã làm đầy đủ nhưng không phải tuyệt đối — đây là hạn chế cơ bản của web client.
