用戶用 VPN，`workflowPrompt` 過長會斷線令 workflow abort。完整任務一律先寫檔，prompt 只放路徑及摘要。

1. 啟動任何 workflow 前，先把完整任務寫入 `.agents/tasks/<topic>-brief.md`（`<topic>` 簡短英文 kebab-case，沿用現有命名如 `stage5a`、`tts-changes`）。
2. 寫檔遵守分段寫入規則；寫完用 `read_file` 讀回確認完整，才可啟動。
3. 任務檔含：目標及成功準則；背景及對話中已作決定；相關檔案絕對路徑；限制（不可改動處）；驗證方法（UI 用瀏覽器截圖或 DOM 檢查）；產出路徑（plan、review、verification 放 `.agents/tasks/`）。
4. `workflowPrompt` 全文 ≤ 約 1500 字元，只放：
   - 任務檔絕對路徑（雙引號包住，路徑含空格）
   - 3–5 行摘要：目標、主要檔案、是否需 worktree 及 base branch、驗證方法；須足夠讓 creator 單憑它設計步驟
   - 指示：「每個步驟的 agent 都必須先讀取任務檔。步驟 prompt 只引用任務檔路徑，不要把任務檔內容抄入 prompt。」
5. `agent://...` 的 `prompt` input 及 `bundled://investigate` 的 `brief` input 同樣只放路徑加簡短摘要。
6. 任務有變更：用 `str_replace` 改任務檔，不在 prompt 追加長文。

失敗：先 `inspect_workflow` 查 `failureReason` 及中斷步驟並告知用戶；結果附 `generated://<id>` 就用它重發，不重呼叫 `workflowPrompt`；同一 workflow 失敗兩次即停並告知用戶，不連續重試。
