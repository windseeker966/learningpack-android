# 手机与 iPad 的同步协议

iPad 上的 LearningPack 是唯一的权威数据：复习安排（FSRS）、作答记录都在 iPad 上算、存。手机只是另一个作答的地方：
iPad 把今天还要做的复习题、要背的单词推给手机，手机离线作答，iPad 再把手机的作答取回去写成作答记录、重算复习安排。

## 连接

- 手机是服务端：前台服务里开一个 HTTP/1.1 服务，端口固定 **47321**，用 mDNS 广播服务类型 `_lpreview._tcp`，
  TXT 记录 `ip=<手机当前的 IPv4>`、`v=1`。
- iPad 是客户端：App 在前台时用 Bonjour 找到手机，读 TXT 里的 ip，连 `http://<ip>:47321`。找不到时用上次连上的地址，
  或设置页里手填的地址。
- 两种网络都适用：宿舍里两台设备连同一个 Wi-Fi；在外面 iPad 连手机的热点（手机就是网关）。
- 每个请求一个连接（`Connection: close`），请求体和响应体都是 UTF-8 JSON（上传图片除外）。

## 配对和签名

- 配对密钥在手机上生成：16 个 Base32 字符（A–Z、2–7，80 位），手机设置页显示为 `XXXX-XXXX-XXXX-XXXX`；
  在 iPad 设置页填同一个（连字符和大小写不计）。密钥按去掉连字符、转大写后的 ASCII 字节使用。
- 请求头：
  - `X-LP-Time`：发出时间，Unix 毫秒
  - `X-LP-Sign`：`hex(HMAC-SHA256(密钥, 方法 + "\n" + 路径（含查询串） + "\n" + X-LP-Time + "\n" + hex(SHA256(请求体))))`
- 手机拒绝签名不对或时间差超过 5 分钟的请求（401）。
- 响应头同样带 `X-LP-Time` 和 `X-LP-Sign`：`hex(HMAC-SHA256(密钥, "response\n" + X-LP-Time + "\n" + hex(SHA256(响应体))))`，
  iPad 校验后才用。
- 十六进制一律小写。

## 一次同步

iPad 每次同步依次调用：

1. `POST /pull`，请求体 `{}`。响应 `{"v":1, "results":[…]}`：手机上还没被确认的全部作答结果，按时间先后。
2. iPad 把结果写进数据库（按结果的 `id` 去重，重复导入不会多出记录），重算复习安排。
3. `POST /push`，请求体见下。手机删掉 `ack` 里的结果，用新的题单、单词替换旧的。响应 `{"needImages":["<sha>", …]}`：
   题单里用到、手机上还没有的图片。
4. 对每张缺的图片 `POST /image?sha=<sha256 hex>`，请求体是图片原始字节。手机核对哈希后存下。

另有 `GET /ping`（请求体为空）：响应 `{"v":1, "pending":<未确认的结果数>}`，用来检查连接和配对。

## push：iPad → 手机

```json
{
  "v": 1,
  "day": "2026-10-25",            // iPad 的当天（早上 0 点切分），手机据此丢掉过期的题单
  "generatedAt": 1761360000000,   // Unix 毫秒
  "ack": ["<结果 id>", …],
  "retention": 0.85,
  "questions": [ <题>, … ],       // 今天还要做的、能在手机上做的复习题，按 iPad 的做题顺序
  "vocab": {
    "due":  [ <词>, … ],          // 今天要背的词（到期的旧词 + 今天还能开始的新词），按 iPad 的顺序
    "pool": [ <词>, … ],          // AI 短文复习可以挑的词：背过的全部词
    "recentPassageKeys": ["<词 key>", …]  // 最近一小时 AI 短文里挑过的词，不再挑
  },
  "facts": {                      // 计算测速
    "doneToday": false,           // 今天在 iPad 上测完过一轮
    "perKind": 10,                // 每类出几题
    "stats": {"sub:13:7": {"seconds": 3.1, "correct": false}}   // 每个事实最近一次的成绩（不算本轮重出的）
  }
}
```

计算测速的题由手机自己抽，规则同 iPad 的 `ArithmeticFacts`（`assets/web/fact.js` 照搬）：四类事实 `add`（a+b，a、b 为 2…9、和不小于 11）、
`sub`（a−b，a 为 11…18，b 和差在 2…9）、`div`（a÷b，b 为 2…9、商 2…9）、`rem`（除数 a 为 2…9、商 b 为 1…9 的倍数区间，
被除数在 a·b+1…a·b+a−1 随机），事实的 key 是 `<类>:<a>:<b>`。每类各抽 `perKind` 个，权重：没测过 2，上次答错 4，
答对的 1 + min(max(用时 ÷ 熟练线 − 1, 0), 2)，熟练线 2 秒（带余除法 3 秒）。

题单只含能在手机上做的题：选择题（不含阅读理解题），以及填空题（主观题里 `format: blank` 的）。综合题不发。
手机上的题单整个替换：iPad 上做掉的题不再出现在题单里，手机上也就不再出。

### 题

```json
{
  "key": "os-2027|2.1-Q07",       // 同 ReviewItem.key
  "pack": "os-2027", "packTitle": "操作系统", "section": "2.1", "id": "2.1-Q07",
  "kind": "choice",               // choice | blank
  "contentHash": "…",             // 选择题同 Grader.contentHash；填空题同 SubjectiveRecords.contentHash
  "lastRating": 3,                // 上一次的评分（FSRSRating 原始值），没有为 null；热身题用
  "estimatedSeconds": 26.0,       // 预计用时
  "choice": {                     // kind == choice 时
    "type": "single",             // single | combo | multi_blank | multi | judge
    "polarity": "positive",       // positive | negative（问「错误的是」）
    "stem": "…",                  // 纯文本 + $…$ 公式；multi_blank 的空写成（ ）
    "options": {"A": "…"},        // single / multi / judge（judge 是 {"正确":"正确","错误":"错误"}）
    "comboOptions": {"A": ["I","III"]},
    "statements": {"I": {"text": "…", "truth": true}},
    "sharedOptions": {"A": "…"},  // multi_blank
    "blanks": [{"answer": "B", "cue": "…"}],
    "answer": "B",                // multi 为 "ABD"；multi_blank 为 null
    "explanation": "…",           // Markdown：公式、代码块、表格、单独一行的 [[图 <图 id>]]
    "figures": ["fig-1"],         // 题干下方的图
    "aiAnswer": false, "aiExplanation": false
  },
  "blank": {                      // kind == blank 时
    "stem": "…", "questionImage": "img:<sha>",
    "parts": [{"label": "(1)", "answer": "…", "accept": ["…", "…"]}],
    "answer": "…",                // Markdown
    "answerImages": ["img:<sha>"],
    "typed": true                 // 键盘填空（input: text），每一空都有 accept
  },
  "images": {"fig-1": {"sha": "…", "caption": "…"}}   // 图 id → 图片；题面图片、答案图片也在这里，键是 "img:<sha>"
}
```

### 词

```json
{"key": "<VocabEntry.key>", "word": "…", "sentence": "…", "meaning": "…", "phonetic": "…", "form": "…",
 "note": "…", "isNew": false, "source": "…"}
```

## pull：手机 → iPad 的作答结果

每条结果都有 `id`（手机生成的 UUID）和 `type`。时间都是 Unix 毫秒。

### 选择题 `choice`

```json
{"id": "…", "type": "choice", "pack": "…", "question": "…", "contentHash": "…",
 "at": 1761360000000,             // 提交时间（AttemptRecord.createdAt）
 "duration": 12.3,                // 作答用时（秒）：手机亮屏、题在屏幕上的时间
 "selection": "B", "selectionHistory": ["A","B"], "selectionTimes": [3.1, 5.2],
 "optionOrder": ["C","A","B","D"], // 打乱时按显示顺序的原题字母；没打乱为 []
 "confidence": "sure",            // sure | unsure | guess
 "feedbackSeconds": 4.2,          // 看答案、解析的时间
 "errorTypes": ["careless"],      // ErrorType 原始值；答对且确定时为 []
 "errorNote": null,
 "sessionID": "phone-…", "sessionIndex": 3}
```

`selection` 等用原题字母，编码同 iPad 的 `Selection.encoded`：单选 `B`；多选按字母排序 `ABD`；判断 `正确`/`错误`；
多空选择 `B,A,C,D`（没选的空是 `_`）。iPad 用当前题目重新判分，不信任手机的对错。

### 填空题 `blank`

```json
{"id": "…", "type": "blank", "pack": "…", "question": "…", "contentHash": "…",
 "createdAt": 1761360000000, "revealedAt": 1761360030000, "assessedAt": 1761360050000,
 "writingSeconds": 25.0, "feedbackSeconds": 10.0,
 "confidence": "sure",            // sure | unsure | gave_up
 "typedAnswers": ["…"],           // 键盘填空题：各空写的（按小问顺序）；其余为 []
 "autoMatched": ["(1)"],          // 和答案一致、自动判对的小问
 "partLabels": ["(1)", "(2)"],
 "partResults": ["correct", "wrong"],   // PartResult 原始值：correct | wrong | blank | skipped
 "partCauses": [{"label": "(2)", "errorTypes": ["misremembered"], "note": null}],
 "sessionID": "phone-…", "sessionIndex": 4}
```

### 背单词 `vocab`

```json
{"id": "…", "type": "vocab", "key": "<VocabEntry.key>", "rating": 3, "at": 1761360000000}
```

`rating` 是 FSRSRating 原始值：1 不认识、2 模糊、3 认识、4 太简单。同一个词一次背单词里可能有多条（「不认识」后同一轮再出现）。

### AI 短文复习 `passage`

```json
{"id": "…", "type": "passage", "title": "…", "passage": "…{{1|surface}}…",
 "createdAt": 1761360000000, "confirmedAt": 1761360300000,
 "items": [{"id": 1, "entryKey": "…", "word": "…", "answer": "…", "result": "correct", "note": null, "rating": 3}],
 "usage": [{"model": "deepseek-flash", "provider": "api.deepseek.com", "isBackup": false, "reportedByServer": true}]}
```

只有确认了自评的短文才发；iPad 记一条 `VocabPassageAttempt`，并按 `confirmedAt` 把各词的 `rating` 计入单词复习。

### 计算测速 `fact`

```json
{"id": "…", "type": "fact", "createdAt": 1761360000000, "finishedAt": 1761360150000,   // 中途退出的 finishedAt 为 null
 "results": [{"key": "rem:7:7", "kind": "rem", "prompt": "50 ÷ 7", "answer": "7余1", "given": "7余1",
              "correct": true, "seconds": 2.4, "thinkSeconds": 1.6, "retry": false, "answeredAt": 1761360002400}]}
```

一轮一条。`seconds` 是出题到点「确定」（只算亮屏时间），`thinkSeconds` 是出题到按第一个键；`retry` 为 true 是本轮答错后在最后重出的一次。
iPad 记一条 `FactDrill`（`phoneID` 是这条的 id），按 key 和题面左边的数还原题目重新判对错，不信任手机的 `correct`、`answer`。

### 跳过 `skip`

```json
{"id": "…", "type": "skip", "pack": "…", "question": "…", "at": 1761360000000, "forever": false}
```

只写进 iPad 的操作日志（`review_skip`，`device: phone`）。跳过的题手机上今天不再出，留给 iPad；
`forever` 为 true 表示以后都不在手机上出（手机自己记着，不影响 iPad）。
