# LearningPack 手机复习（Android）

iPad 上的 LearningPack（`/Users/wind/vscode/Learning`）的手机端，用来在碎片时间做复习题、背单词。
复习安排、作答记录都在 iPad 上；手机只存 iPad 推过来的今天的题单、单词，和还没交回 iPad 的作答。同步协议见 [PROTOCOL.md](PROTOCOL.md)。

## 功能

- 做复习题：今天复习计划里还没做的选择题（单选、多选、组合、判断、多空选择）和填空题（键盘填空自动比对，其余自评），一组 5 道，第一组先做几道上次答得好的短题热身。选项打乱规则、判分、填空比对从 iPad 的 `OptionOrder`、`Grader`、`BlankMatcher` 移植。答错或没把握时选错因，和 iPad 一样。
- 跳过：需要写字的题点「跳过」：「今天先跳过（留给 iPad 做）」，或「以后都不在手机上出这道题」。
- 背单词：今天要背的词，流程同 iPad 的生词复习（不认识的词本轮再出现）。
- AI 短文复习生词：从背过的词里挑几个，请 AI 写一篇短文，写出各词在文中的意思，AI 批改后自评。提示词、短文里生词标记的解析照搬 iPad 的 `VocabPassageAI`、`VocabPassage`。API Key 在「设置」里填（默认 DeepSeek 的 Anthropic 兼容接口）。
- 计算测速：进位加法、退位减法、表内除法、带余除法各抽 10 题，屏幕键盘作答（带「余」键），自动判对错、计时；上次答错、答得慢的多抽（用 iPad 推来的各事实最近成绩），答错的显示答案、本轮最后再出一次。规则照搬 iPad 的 `ArithmeticFacts`（`assets/web/fact.js`），每轮结果交给 iPad 记成 `FactDrill`。中途退出的，当天再进来接着做剩下的题（首页显示「继续 · 还剩 N 题」），还是同一轮。iPad 或手机上今天测完过一轮，首页显示「今天测过了 · 再测一轮」。首页的「计算的背诵表和方法」和测速页顶上的「背诵表」打开背诵表（`assets/web/guide.js`，内容同 iPad 的 `FactGuideView`；测速中打开时这一题暂停计时）。
- 作答计时只算 App 在前台、题目在屏幕上的时间。

## 同步

- 前台服务里开一个 HTTP 服务（端口 47321），用 mDNS 广播 `_lpreview._tcp`；iPad App 在前台时来连。宿舍里两台设备连同一个 Wi-Fi，在外面 iPad 连手机的热点。
- 配对：「设置」里的配对密钥填到 iPad「设置 › 手机复习」。请求、响应都用密钥签名，换了密钥 iPad 要重新填。
- 每次同步：iPad 先取走手机上的作答（写进 iPad 的数据库、重算复习安排后再确认，手机才删），再推来新的题单和单词，手机整个替换。所以 iPad 上做掉的题，手机上也不再出。
- 手机会在后台被系统杀掉：「设置」里点「允许在后台运行」（关闭电池优化），HyperOS 上还要在「打开应用信息」里允许自启动。开机后自动启动服务。

## 构建与安装

构建配置同 subword-android、time-tracker-android：Java 17，平台自带 View 和 WebView（做题页面是 `app/src/main/assets/web/` 下的网页，公式用打包进去的 KaTeX 0.19.1），没有第三方库。

```sh
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 在模拟器上测

用单独的 AVD（不要用别的项目在用的）。安卓模拟器在 NAT 后面，iPad 模拟器连不到它的地址，转发端口后让 iPad 模拟器连本机：

```sh
adb forward tcp:47321 tcp:47321
# iPad 模拟器（Debug 构建）：
xcrun simctl launch <模拟器> com.wind.studypack -debugPhoneSecret <配对密钥> -debugPhoneHost 127.0.0.1
```

模拟器自带的 WebView 版本可能很旧（API 30 的 ATD 镜像是 83），新的 CSS（如 flex 的 `gap`）在上面不生效，真机上正常。
