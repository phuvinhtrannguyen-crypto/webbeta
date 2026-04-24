# ExamHub — Test Plan

**PR**: https://github.com/phuvinhtrannguyen-crypto/webbeta/pull/1
**Environment**: local `python3 -m http.server 8123` serving `index.html` against the real Firebase project `websieucapluyenjthi` (user-provided config, open test rules).

## What changed (user-visible)

- Brand-new single-file web app: beautiful auth page (login / register / forgot / Google), role-based 3-page dashboard (Admin · Teacher · Student), Firebase-backed, with AI exam generation and anti-cheat.
- Every major feature called out in the user's spec is implemented in `index.html` (~3008 LOC).

## Pre-test escalation (quick, not recorded)

Admin email `phuvinhtrannguyen@gmail.com` belongs to the user; I don't have its password. Workaround: register a fresh test account, then promote it to `role: "admin"` in Firestore via the browser console (test rules permit it). This is the ONLY devtools action allowed — all subsequent steps use the UI.

```js
// Paste once in console right after registration:
const fb = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
const app = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
const db = fb.getFirestore(app.getApp());
await fb.updateDoc(fb.doc(db,"users",window.ExamHub.state.user.uid),{role:"admin"});
```

## Primary flow (recorded)

### T1. Auth — register + log in
1. Open `http://localhost:8123/index.html`. → Expect aurora/glassmorphism auth screen; **the text "null" must NOT be visible** between tabs and the Email field (regression from earlier bug).
2. Click "Đăng ký" tab. Fill name, email `devin-test-<ts>@example.com`, password `Devin12345`. Submit.
3. **Pass**: toast "Tạo tài khoản thành công!" and the app auto-navigates to a dashboard (student view by default).

### T2. Admin features
4. Console-escalate the account to `role:"admin"` (see pre-test), then reload.
5. Sidebar brand should read **"Admin console"**. Nav should include "Tổng quan · Người dùng · Key giáo viên · Đề thi · Yêu cầu · API & cài đặt".
6. Go to **Key giáo viên** → click "Tạo key mới". **Pass**: a new row appears in the table with a generated code, unused status, and copy button. Copy the key text.
7. Go to **API & cài đặt** → paste a dummy Gemini key `TEST-KEY-xyz` and save. **Pass**: toast success; reload → field still populated from Firestore.

### T3. Teacher features
8. Log out (topbar avatar menu → "Đăng xuất"). Register another account `devin-teacher-<ts>@example.com`.
9. In Teacher dashboard → **Hồ sơ** tab → enter the teacher key from step 6 → redeem. **Pass**: toast "Đã kích hoạt giáo viên" and role in topbar now shows Teacher.
10. **Lớp học** → "Tạo lớp" → name "Lớp 12A1" → save. **Pass**: card "Lớp 12A1" appears.
11. Inside the class, add 1 student "Nguyen Van A" with code `HS001`. **Pass**: student shows up in the list.
12. **Đề thi** → "Tạo đề mới" → title "Kiểm tra 15 phút", duration 5 min, add 2 questions:
    - Q1 type=MCQ: stem "2+2=?", options "3/4/5", answer index 1 (→ "4").
    - Q2 type=short: stem "Thủ đô Việt Nam?", answer "Hà Nội".
    Save. **Pass**: card for the exam appears with Share/Lock/Delete buttons.
13. Click **Chia sẻ** on the exam card. **Pass**: modal opens with a QR image and a copyable URL containing `#join/<examId>`.

### T4. Student flow (another tab, incognito not required since we're logging out)
14. Copy the URL, log out, paste URL. Screen should ask for student name (not logged in).
15. Enter "Test Student", click Start. **Pass**: exam page renders with title, timer, 2 question cards.
16. Answer Q1 = "4" (correct), Q2 = "hanoi" (fuzzy — close to "Hà Nội"). Submit.
17. **Pass**: result card shows a percentage; expected **75%** (MCQ right = 1.0 + fuzzy match via normalize(`hanoi` vs `hanoi`) = 1.0 → **100%**, so actually we expect 100%). Revised expectation: if both normalize equal → 100%; if dice ≥0.7 & <0.95 → 75%. Our pair should hit ≥0.95 → **100%**. Recording will capture the actual number.
18. Try Q2 with a deliberately off answer "Ha Noiiiii" instead — **second attempt** → expect partial or wrong. (Optional if time; otherwise skip.)

### T5. Teacher sees the submission
19. Log back into the teacher account. Go to **Thống kê bài nộp** or open the exam → **Bài nộp**.
20. **Pass**: row "Test Student" with the exam title and the same score shown on the student's result screen.
21. Open the exam analytics modal — "Phân tích theo câu hỏi" should show per-question accuracy and "Top 5 điểm cao nhất" should list Test Student.

### T6. Anti-cheat sanity check
22. Student tab: take the exam again (new attempt). Do not click fullscreen button; instead just answer and press Tab away / press `Esc` to exit fullscreen. Each violation should bump a counter chip in the exam header.
23. **Pass**: counter increments visibly; after 3 violations, exam **locks** (submission blocked with "Bài thi đã khoá" toast/banner).

## Adversarial check
For each step, would a broken build show the same thing?
- If exam serialization is broken, step 15 would show no questions → **would fail visibly**.
- If grading is broken, step 17 would show 0% or NaN → **would fail visibly**.
- If Firestore real-time sync is broken, step 20 would show empty table → **would fail visibly**.
- If anti-cheat is broken, counter stays at 0 on Esc → **would fail visibly**.

## Not tested (known constraints)
- Real Gemini AI generation — requires a real API key from user.
- Google Sign-In popup — not guaranteed to work on `http://localhost` without authorized domain setup; skipped.
- Admin login as `phuvinhtrannguyen@gmail.com` — user owns that account; I use the Firestore-role workaround to exercise admin screens.

## Evidence
Recording will cover T1 → T6. Failures will be flagged with red annotations.
