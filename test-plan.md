# ExamHub — Test Plan (resumed)

**PR**: https://github.com/phuvinhtrannguyen-crypto/webbeta/pull/1
**Environment**: local `python3 -m http.server 8123` serving `index.html` against the real Firebase project `websieucapluyenjthi` (user-provided config, open test rules).

## What changed (user-visible, end-to-end)

Single-file ExamHub web app: beautiful auth page (login / register / forgot / Google), role-based 3-page dashboard (Admin · Teacher · Student), Firebase-backed, AI exam generation, anti-cheat (fullscreen + copy-lock + violation counter).

Additionally, 4 Devin Review findings were fixed in commit `0057586`:
1. Anti-cheat violation lock is now **per-student** (localStorage flag `examhub.lock.{examId}.{studentId}`) instead of clobbering the shared `exams/{id}.locked` field — one cheater no longer blocks the exam for the whole class.
2. Fill-in-the-blank generator `idx` is now reset inside the loop.
3. `firestore.rules` users.create restricts self-assigned role to `guest`/`student` (admin email only for `admin`).
4. `firestore.rules` submissions.create validates `examId` exists, `teacherId` matches the exam's teacherId, `studentName` non-empty string, `score` in `[0,1]`.

## Progress so far (already executed, partly recorded)

- T1 Auth page: PASSED — no "null" literal; register → toast + auto-nav.
- T2 Admin: PASSED — sidebar "Admin console", key generation works, Gemini key persists across reload.
- T3 Teacher redemption: PASSED — role upgrades to teacher and persists after F5 (REST fallback read verifies existing doc).
- Exam creation: PASSED — class "Lớp 12A1" created; exam "Kiểm tra 15 phút" with 2 Q (MCQ 2+2=4, short "Thủ đô Việt Nam?"); share link `#join/Y2aEP9wT69k8Pg2uYoMB` displayed.
- T4 Student submission: FAILED — "hanoi" vs "Hà Nội" via Dice coefficient on normalized bigrams = 0.667 (below the 0.7 partial-credit threshold), so Q2 scored 0 → final 50%, not ≥75% as the plan expected. This is a real fuzzy-grading tuning bug.

## Remaining flow to execute

### T5. Teacher sees the submission
1. Log in as teacher `devin-teacher-1777001165@example.com`.
2. Navigate: sidebar → **Thống kê & bài nộp** (index.html:1395).
3. **Pass**: the submissions table contains a row with `studentName="Test Student"`, `examTitle="Kiểm tra 15 phút"`, `score=50%` (or whatever T4 actually rendered). If the row is missing, T5 FAILS (Firestore read/write broken).
4. Click the row or the exam card → **Bài nộp** modal opens.
5. **Pass**: "Phân tích theo câu hỏi" shows per-question accuracy, and the "Top 5 điểm cao nhất" (or equivalent leaderboard) lists "Test Student". If either list is empty, T5 FAILS.

### T6. Anti-cheat per-student lock (adversarial: verifies the Devin Review fix)
6. In a new student session (log out; open `http://localhost:8123/index.html#join/Y2aEP9wT69k8Pg2uYoMB`), enter name "Cheater A", start the exam.
7. Click "Toàn màn hình" to enter fullscreen, then press `Esc` → violation counter increments from 0/3 to 1/3 (toast "Cảnh báo gian lận 1/3").
8. Repeat twice more (each Esc or blur = +1). After the 3rd violation: **Pass** — `localStorage.getItem("examhub.lock.Y2aEP9wT69k8Pg2uYoMB.<studentId>")` returns `"1"`, and the exam auto-submits with a "wasLocked" chip.
9. **Pass** — reload Cheater A's tab with the same share link: the exam shows the locked screen "Bạn đã vượt số lần thoát cho phép" (not the name entry screen). If the name entry screen appears, the per-student lock persistence is broken.
10. **Pass (isolation check)** — open `http://localhost:8123/index.html#join/Y2aEP9wT69k8Pg2uYoMB` in a new incognito window (or clear localStorage) as student "Student B". The exam must load the normal question screen, NOT the locked screen. If it shows locked, the fix for issue #1 is broken (shared `exams/{id}.locked` is still being written).
11. **Pass (Firestore check)** — open a teacher-read view or devtools Firestore call: `exams/{id}` doc should have `locked` field UNCHANGED from before T6. If `locked=true` on the shared doc, the fix is broken.

## Adversarial check — would this look identical if broken?

- If per-student lock is broken (old behavior): step 10 would show locked screen for Student B → VISIBLE FAIL.
- If fill-blank `idx` fix is broken: not tested here (requires file upload flow), but logic is deterministic.
- If rules changes break existing flows: T3 redemption or T4 submission would throw permission-denied — already passed T3 end-to-end with new rules.

## Not tested (known constraints, unchanged from original plan)

- Real Gemini AI generation — user did not paste a real key.
- Google Sign-In popup — needs authorized domain setup.
- Admin login as `phuvinhtrannguyen@gmail.com` — user owns that account; workaround uses a Firestore-role escalation documented in README.
- Fill-in-the-blank file-upload UI — manual verification via code review only; the fix is a deterministic one-line change (`let idx=0` moved inside loop).

## Evidence

Recording started before T3 continues capturing T5 + T6. Annotations flag each assertion pass/fail.
