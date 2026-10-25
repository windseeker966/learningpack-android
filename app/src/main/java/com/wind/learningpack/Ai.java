package com.wind.learningpack;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 调 AI（生词的 AI 短文复习）：Anthropic Messages 或 OpenAI 兼容（Chat Completions）接口，流式接收、整段返回。
 * 改自 subword-android 的 Ai.java；设置（接口、地址、模型、Key）只存在这台手机上。提示词同 iPad 上 LearningPack 的 VocabPassageAI
 */
final class Ai {
    static final String PROTO_ANTHROPIC = "anthropic";
    static final String PROTO_OPENAI = "openai";

    static final String KEY_PROTO = "proto";
    static final String KEY_BASE = "baseURL";
    static final String KEY_MODEL = "model";
    static final String KEY_API_KEY = "apiKey";

    static final String DEFAULT_PROTO = PROTO_ANTHROPIC;
    static final String DEFAULT_BASE = "https://api.deepseek.com/anthropic";
    static final String DEFAULT_MODEL = "deepseek-flash";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("ai", Context.MODE_PRIVATE);
    }

    static boolean configured(Context c) {
        return !prefs(c).getString(KEY_API_KEY, "").trim().isEmpty();
    }

    // ---- 提示词（同 LearningPack 的 VocabPassageAI） ----

    static final String PASSAGE_SYSTEM =
            "你是考研英语老师。学生在复习背过的生词。请写一篇英文短文，把【生词】里的每个词都自然地用进去。\n"
            + "要求：\n"
            + "1. 150–250 词，像考研阅读那样的说明文或议论文，话题自由；\n"
            + "2. 每个词只用一次，用的是【意思】里的那个意思，可以按语法变形（时态、单复数等）；实在放不进去的词可以不用；\n"
            + "3. 其余部分只用常见词，让难点只在这些生词上；上下文不要直接解释生词的意思；\n"
            + "4. 用到某个词时写成 {{编号|文中形式}}，如 {{3|abandoned}}，编号照抄【生词】里的编号。\n"
            + "只输出一个 JSON 对象，不要其他文字：{\"title\": \"短文标题\", \"passage\": \"短文正文，段落之间用 \\n\\n 分隔\"}";

    static final String GRADING_SYSTEM =
            "你是考研英语老师。学生读了一篇英文短文，写出其中标出的词在文中的中文意思。请逐个判断：\n"
            + "- correct：意思对。中文说法不同、词性略有出入，只要理解对就算对；\n"
            + "- partial：方向大致对，但不准确或只答对一部分；\n"
            + "- wrong：意思错了，或没写。\n"
            + "只输出一个 JSON 对象，不要其他文字：{\"results\": [{\"id\": 编号, \"result\": \"correct | partial | wrong\", \"note\": \"不是 correct 时，一句话给出这个词在文中的准确意思；correct 时省略\"}]}\n"
            + "逐项列出【学生作答】里的每个编号。";

    // ---- 请求 ----

    /** 一次回答：全文和用的模型（usage 同 iPad 的 LLMUsage） */
    static final class Completion {
        final String text;
        final JSONObject usage;

        Completion(String text, JSONObject usage) {
            this.text = text;
            this.usage = usage;
        }
    }

    /** 在当前线程里同步请求（调用方放到后台线程）。失败抛出带说明的异常 */
    static Completion complete(Context c, String system, String user, int maxTokens) throws Exception {
        // 关掉思考更快；不认识 thinking 参数的接口（返回 400）去掉它再请求一次
        try {
            return complete(c, system, user, maxTokens, true);
        } catch (ThinkingUnsupported e) {
            return complete(c, system, user, maxTokens, false);
        }
    }

    private static final class ThinkingUnsupported extends Exception {}

    private static Completion complete(Context c, String system, String user, int maxTokens, boolean noThinking)
            throws Exception {
        SharedPreferences p = prefs(c);
        String proto = p.getString(KEY_PROTO, DEFAULT_PROTO);
        String base = p.getString(KEY_BASE, DEFAULT_BASE).trim();
        String model = p.getString(KEY_MODEL, DEFAULT_MODEL).trim();
        String key = p.getString(KEY_API_KEY, "").trim();
        if (key.isEmpty()) throw new Exception("还没有设置 API Key：在首页右上角「设置」里填写");
        boolean anthropic = PROTO_ANTHROPIC.equals(proto);
        HttpURLConnection conn = null;
        try {
            URL url = new URL(endpoint(base, anthropic));
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(120000);
            conn.setDoOutput(true);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "text/event-stream");
            JSONObject body = new JSONObject();
            body.put("model", model);
            body.put("max_tokens", maxTokens);
            body.put("stream", true);
            JSONArray messages = new JSONArray();
            if (anthropic) {
                conn.setRequestProperty("x-api-key", key);
                conn.setRequestProperty("anthropic-version", "2023-06-01");
                body.put("system", system);
                if (noThinking) body.put("thinking", new JSONObject().put("type", "disabled"));
            } else {
                conn.setRequestProperty("Authorization", "Bearer " + key);
                messages.put(new JSONObject().put("role", "system").put("content", system));
            }
            messages.put(new JSONObject().put("role", "user").put("content", user));
            body.put("messages", messages);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code / 100 != 2) {
                String error = readAll(conn.getErrorStream());
                if (anthropic && noThinking && code == 400 && error.contains("thinking")) throw new ThinkingUnsupported();
                throw new Exception("请求失败（HTTP " + code + "）：" + shorten(error));
            }
            String stop = null, reported = null;
            StringBuilder text = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (!line.startsWith("data:")) continue;
                    String data = line.substring(5).trim();
                    if (data.isEmpty() || data.equals("[DONE]")) continue;
                    JSONObject event = new JSONObject(data);
                    String reason = stopReason(event, anthropic);
                    if (reason != null) stop = reason;
                    String m = reportedModel(event, anthropic);
                    if (m != null && !m.isEmpty()) reported = m;
                    String delta = delta(event, anthropic);
                    if (delta != null) text.append(delta);
                }
            }
            if ("max_tokens".equals(stop) || "length".equals(stop)) throw new Exception("AI 的回答太长被截断了，请重试");
            if (text.length() == 0) throw new Exception("AI 没有返回内容" + (stop == null ? "" : "（结束原因：" + stop + "）"));
            JSONObject usage = new JSONObject()
                    .put("model", reported != null ? reported : model)
                    .put("provider", url.getHost())
                    .put("isBackup", false)
                    .put("reportedByServer", reported != null);
            if (stop != null) usage.put("finishReason", stop);
            return new Completion(text.toString(), usage);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String stopReason(JSONObject o, boolean anthropic) {
        if (anthropic) {
            JSONObject d = o.optJSONObject("delta");
            return "message_delta".equals(o.optString("type")) && d != null && !d.isNull("stop_reason") ? d.optString("stop_reason") : null;
        }
        JSONArray choices = o.optJSONArray("choices");
        JSONObject first = choices == null ? null : choices.optJSONObject(0);
        return first == null || first.isNull("finish_reason") ? null : first.optString("finish_reason");
    }

    private static String reportedModel(JSONObject o, boolean anthropic) {
        if (anthropic) {
            JSONObject m = o.optJSONObject("message");
            return "message_start".equals(o.optString("type")) && m != null ? m.optString("model", null) : null;
        }
        return o.optString("model", null);
    }

    private static String delta(JSONObject o, boolean anthropic) {
        if (anthropic) {
            if ("error".equals(o.optString("type"))) throw new IllegalStateException(o.optJSONObject("error") + "");
            if (!"content_block_delta".equals(o.optString("type"))) return null;
            JSONObject d = o.optJSONObject("delta");
            return d != null && "text_delta".equals(d.optString("type")) ? d.optString("text") : null;
        }
        JSONArray choices = o.optJSONArray("choices");
        if (choices == null || choices.length() == 0) return null;
        JSONObject d = choices.optJSONObject(0).optJSONObject("delta");
        return d == null || d.isNull("content") ? null : d.optString("content");
    }

    /** 和 LearningPack 的 LLMEndpoint.url 一样：裸地址按 /v1 处理，已经是完整接口地址的不动 */
    static String endpoint(String base, boolean anthropic) {
        String b = base;
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        URL u;
        try { u = new URL(b); } catch (Exception e) { return b; }
        String path = u.getPath();
        if (anthropic) {
            if (!path.endsWith("/messages")) b += path.endsWith("/v1") ? "/messages" : "/v1/messages";
        } else if (!path.endsWith("/chat/completions")) {
            b += (path.isEmpty() ? "/v1" : "") + "/chat/completions";
        }
        return b;
    }

    private static String readAll(InputStream in) {
        if (in == null) return "";
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder s = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) s.append(line).append('\n');
            return s.toString().trim();
        } catch (Exception e) {
            return "";
        }
    }

    private static String shorten(String s) {
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }

    private Ai() {}
}
