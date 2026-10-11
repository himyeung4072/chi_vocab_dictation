---
inclusion: fileMatch
fileMatchPattern: '{index.html,app.js,style.css,manifest.json,sw.js,fonts/**,icons/**}'
---

改動上述任何檔案後，`sw.js` 的 `CACHE_VERSION` 加一。
- 殼檔案是 stale-while-revalidate，不加也會在下次載入後更新；但新增／刪除預快取檔案、或需新舊檔案同步時必須加。
- 新增殼檔案時同時更新 `sw.js` 的 `SHELL` 清單。
- 不確定就加。
