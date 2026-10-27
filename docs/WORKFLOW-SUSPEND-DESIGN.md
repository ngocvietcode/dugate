# Workflow không giữ slot worker khi chờ AI (ARCHITECTURE E4)

> Trạng thái: **đề xuất, chờ duyệt** (2026-10-27). Phạm vi: engine dùng chung `lib/pipelines/workflow-engine.ts` và `worker.ts`,
> áp trước cho `loan-appraisal`. Liên quan: D-102 (dùng lại sub-step đã SUCCEEDED), [loan-appraisal/ARCHITECTURE.md](loan-appraisal/ARCHITECTURE.md) E4.

## 1. Vấn đề

| Thực tế trong code | Hệ quả |
|---|---|
| Worker `pipeline` xử lý cả job pipeline lẫn job workflow, `concurrency = WORKER_CONCURRENCY` (mặc định 5) | Tối đa 5 hồ sơ chạy cùng lúc trên một worker |
| Job workflow (cha) gọi `enqueueSubStep` rồi **chờ đồng bộ** sub-step trên queue `steps` (event BullMQ + poll DB 3 giây) | Trong lúc chờ LLM (đa số thời gian), slot cha bị chiếm mà không dùng CPU |
| S1 / S2 fan-out tối đa 4 lời gọi đồng thời mỗi hồ sơ (`MAX_PARALLEL_MODEL_CALLS`) | Hồ sơ 60 file: S2 mất nhiều phút; trong lúc đó slot bị giữ |
| Mỗi job cha giữ nội dung file trong bộ nhớ (`contentByPath`, `stage-adapters.ts`); worker tự dừng nhận job khi heap ≥ 90 % | Tăng `concurrency` không giới hạn được: bộ nhớ mới là trần thật |

Kịch bản lỗi: 5 hồ sơ SME lớn cùng vào → mọi hồ sơ sau (kể cả hồ sơ 2 file) xếp hàng tới khi một hồ sơ lớn xong.

## 2. Phương án

| | A. Queue riêng cho workflow + concurrency theo bộ nhớ | B. Tạm ngừng & chạy lại (suspend / replay) | C. Engine workflow bền vững ngoài (Temporal…) |
|---|---|---|---|
| Ý tưởng | Tách job workflow khỏi queue `pipeline`, worker riêng với `WORKFLOW_CONCURRENCY` cao hơn (VD 20), có trần bộ nhớ | Cha gặp sub-step chưa có kết quả → enqueue con rồi **trả slot** (`moveToWaitingChildren`); con xong → cha được chạy lại từ đầu; sub-step đã xong trả kết quả tức thì nhờ D-102 | Thay engine |
| Công sức | Nhỏ (cấu hình + routing queue) | Trung bình – lớn (engine + kỷ luật code workflow) | Rất lớn |
| Rủi ro | Thấp | Trung bình: code workflow phải tất định giữa các lần chạy lại | Cao |
| Giải quyết gốc? | Một phần: vẫn giữ slot, chỉ nhiều slot hơn; bộ nhớ là trần | Có: slot chỉ bị giữ khi có việc CPU | Có |

**Đề xuất: làm A ngay, B sau khi đo; không làm C.** A gỡ nghẽn với công sức nhỏ. B là đích dài hạn, và D-102 đã làm phần khó nhất của nó.

## 3. Phương án A (làm ngay)

1. Queue `workflow` riêng (cùng cơ chế routing worker-group hiện có, `lib/queue/worker-group-router.ts`); submit job workflow vào đó thay cho `pipeline`.
2. `worker.ts` thêm worker cho queue này, `concurrency = WORKFLOW_CONCURRENCY` (mặc định 20), cùng `stalledInterval` / `maxStalledCount`.
   Bộ giám sát heap hiện có (dừng ở 90 %, chạy lại ở 75 %) phủ cả worker mới.
3. Giảm bộ nhớ mỗi cha: `contentByPath` giữ nội dung file suốt lần chạy; đổi sang đọc khi cần và bỏ khỏi cache sau khi stage xong
   (hoặc LRU theo tổng byte). Đo trước và sau bằng `process.memoryUsage()` trên hồ sơ lớn.
4. Không đổi gì trong code workflow.

**Kiểm chứng:** 20 hồ sơ chạy đồng thời trên một worker, hồ sơ 2 file vào sau vẫn bắt đầu ngay; heap không vượt 75 % ở tải thử.

## 4. Phương án B (đích dài hạn)

### 4.1 Cơ chế

```
lần chạy k của job cha
  └─ workflow chạy từ đầu; mỗi enqueueSubStep(..., { reuseKey })
       ├─ đã có sub-step SUCCEEDED cùng khoá (D-102) → trả kết quả ngay
       └─ chưa có → tạo sub-operation + job con (BullMQ flow: con có parent = job cha), KHÔNG chờ;
                   ném SuspendError (pass-through, như WorkflowCancelledError)
  └─ runWorkflow bắt SuspendError: chờ mọi lệnh enqueue đang dở xong → job.moveToWaitingChildren(token) → throw WaitingChildrenError
       → BullMQ trả slot; job cha sang trạng thái waiting-children
mọi con xong → BullMQ đưa cha về wait → lần chạy k+1 (bắt đầu lại từ đầu)
```

Fan-out (`Promise.all` ở S1 / S2): mọi nhánh chưa có kết quả đều enqueue con trong cùng lần chạy rồi cùng tạm ngừng, nên một
lần tạm ngừng chờ cả nhóm, không chờ từng file.

### 4.2 Điều kiện bắt buộc với code workflow (opt-in theo workflow)

| # | Điều kiện | loan-appraisal hiện tại |
|---|---|---|
| B1 | Mọi lời gọi AI có `reuseKey` tất định (không chứa thời gian, số ngẫu nhiên) | S1, S2: có (D-102). Precheck, rule LLM: **chưa** — cần thêm khoá. Rule LLM cố ý không dùng lại kết quả cũ giữa các lần resume (P6); trong cùng một job (giữa các lần chạy lại) dùng lại là an toàn vì đầu vào giống hệt |
| B2 | `SuspendError` đi xuyên mọi `catch`. Các `catch` hiện "nuốt" lỗi LLM thành UNAVAILABLE / NOT_RUN phải rethrow nó | Precheck (`isPassThroughError`), rule LLM (`catch` trong stage 3), port S1/S2 (`isPassThroughError`) — phải sửa từng chỗ |
| B3 | Tác dụng phụ trước điểm tạm ngừng phải idempotent | `updateProgress` (ghi đè) ổn; `saveStep` theo `stage_key` ổn; webhook chỉ ở cuối |
| B4 | Code giữa các lời gọi AI tất định | S3, tài chính, rule engine: thuần |

Workflow chưa đạt B1–B4 giữ chế độ chờ đồng bộ hiện tại (cờ theo workflow trong registry, mặc định tắt).

### 4.3 Chi tiết phải chốt khi làm

- **Chi phí:** tổng của cha chỉ ghi ở điểm kết thúc (D-102). Khi tạm ngừng **không** ghi tổng; lần chạy cuối cộng usage của mọi con đúng một
  lần (`ctx._accountedSubOps` sống trong một lần chạy, mỗi lần chạy nạp tổng từ DB — vẫn đúng vì tổng chưa từng được ghi).
- **Con lỗi:** `reusableSubStep` nhả khoá row FAILED rồi enqueue lại → có thể lặp vô hạn. Cần trần số lần thử theo khoá (đếm row cùng
  tiền tố `wfstep:<parent>:<hash>` hoặc lưu bộ đếm trong job data); quá trần → lỗi như hiện nay (`Sub-step … failed`).
- **Huỷ:** `assertNotCancelled` ở đầu mỗi lần chạy lại; job cha ở waiting-children bị huỷ → xoá job con chưa chạy (`removeUnprocessedChildren`).
- **Timeout tổng của workflow** (`maxWaitMs`) tính theo thời gian thực từ lần chạy đầu (lưu mốc bắt đầu), không theo từng lần chạy lại.
- **Tiến trình:** `progress_message` giữ thông điệp cuối; thêm "Đang chờ N bước AI" khi tạm ngừng.
- **Stalled / retry của BullMQ:** `WaitingChildrenError` không tính là thất bại; `attempts` chỉ cho lỗi thật.
- **Đọc file:** mỗi lần chạy lại đọc lại file cần dùng; kết hợp §3.3 để không giữ toàn bộ trong bộ nhớ.

### 4.4 Kiểm chứng

- Test engine với BullMQ thật trên Redis test: 1 cha, 3 con song song, cha trả slot khi chờ (đo `getActiveCount`), kết quả giống chế độ đồng bộ.
- Test loan-appraisal: cùng fixture chạy chế độ đồng bộ và suspend cho kết quả cuối giống hệt (trừ id sub-operation), tổng token bằng nhau.
- Tải: 50 hồ sơ đồng thời với `concurrency = 5`, không hồ sơ nào chờ quá thời gian xử lý CPU của chính nó.

## 5. Cần quyết

1. Duyệt phương án A để làm ngay? (đề xuất: có)
2. B: làm sau khi A chạy thật và có số đo, hay làm luôn cho loan-appraisal? (đề xuất: sau A, khi tải thật cho thấy cần)
