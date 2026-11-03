package com.wind.learningpack;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * 经中转服务器和 iPad 交换数据（协议见 PROTOCOL.md 的「中转」）：不在同一个网络时 iPad 连不上手机，
 * 手机每 2 分钟去中转服务器放下作答结果和学习时间（up）、取 iPad 放下的题单（down）；有新的作答结果时 5 秒后再来一次。
 * 内容用配对密钥加密（RelayCrypto）。由 SyncService 启动，网络请求都在自己的线程上
 */
final class Relay {
    private static final String TAG = "Relay";
    static final String DEFAULT_ADDRESS = "129.146.200.163:47322";
    static final String KEY_ADDRESS = "address";
    private static final long INTERVAL_S = 120;
    /** up 没变时最多隔这么久再传一次 */
    private static final long REFRESH_UP_MS = 10 * 60_000L;

    private final Context context;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    private final Runnable onChange = this::soon;
    private ScheduledFuture<?> pending;
    private String lastUpHash = "";
    private long lastUpAt;

    Relay(Context context) {
        this.context = context.getApplicationContext();
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("relay", Context.MODE_PRIVATE);
    }

    static String address(Context c) {
        String a = prefs(c).getString(KEY_ADDRESS, "").trim();
        return a.isEmpty() ? DEFAULT_ADDRESS : a;
    }

    void start() {
        executor.scheduleWithFixedDelay(this::cycleQuietly, 5, INTERVAL_S, TimeUnit.SECONDS);
        Store.addListener(onChange);
    }

    void stop() {
        Store.removeListener(onChange);
        executor.shutdownNow();
    }

    /** 作答结果变了（Store 的监听在主线程）：5 秒后收发一次，连着的几次合成一次 */
    private synchronized void soon() {
        if (executor.isShutdown()) return;
        if (pending != null) pending.cancel(false);
        pending = executor.schedule(this::cycleQuietly, 5, TimeUnit.SECONDS);
    }

    private void cycleQuietly() {
        try {
            cycle();
        } catch (Exception e) {
            Log.w(TAG, "relay: " + e);
        }
    }

    private void cycle() throws Exception {
        String secret = Auth.secret(context);
        String base = "http://" + address(context) + "/box/" + RelayCrypto.mailbox(secret);
        Store store = Store.get(context);
        // 1. 放下作答结果和学习时间（同 /pull 的响应）；没变时 10 分钟内不重复传
        JSONArray results = store.pendingResults();
        JSONObject study = StudyTime.get(context).today();
        String hash = Auth.sha256Hex((results + "|" + study).getBytes(StandardCharsets.UTF_8));
        long now = System.currentTimeMillis();
        if (!hash.equals(lastUpHash) || now - lastUpAt > REFRESH_UP_MS) {
            JSONObject up = new JSONObject().put("v", 1).put("sentAt", now).put("results", results).put("study", study);
            put(base + "/up", RelayCrypto.seal(up.toString().getBytes(StandardCharsets.UTF_8), secret, "up"));
            lastUpHash = hash;
            lastUpAt = now;
        }
        // 2. 取 iPad 放下的题单：比上次用过的（局域网或中转）新才用
        SharedPreferences p = prefs(context);
        Response down = get(base + "/down", p.getString("downEtag", null));
        if (down == null) return;
        JSONObject push = new JSONObject(new String(RelayCrypto.open(down.body, secret, "down"), StandardCharsets.UTF_8));
        if (push.optLong("generatedAt") > store.generatedAt()) {
            List<String> need = store.applyPush(push);
            // BudgetReport.ipad(context, push.optJSONObject("studyCode"));  // 手机额度已关闭：不再报给「时间记录」
            for (String sha : need) {
                Response img = get(base + "/img/" + sha, null);
                if (img != null) store.saveImage(sha, RelayCrypto.open(img.body, secret, "img:" + sha));
            }
            Log.i(TAG, "applied relay push, images " + need.size());
        }
        p.edit().putString("downEtag", down.etag).apply();
    }

    private static final class Response {
        byte[] body;
        String etag;
    }

    /** 没有（404）或没变（304）时为 null */
    private static Response get(String url, String etag) throws Exception {
        HttpURLConnection c = open(url);
        if (etag != null) c.setRequestProperty("If-None-Match", etag);
        try {
            int status = c.getResponseCode();
            if (status == 404 || status == 304) return null;
            if (status != 200) throw new IllegalStateException("GET " + status);
            Response r = new Response();
            r.etag = c.getHeaderField("ETag");
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[64 * 1024];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                r.body = out.toByteArray();
            }
            return r;
        } finally {
            c.disconnect();
        }
    }

    private static void put(String url, byte[] body) throws Exception {
        HttpURLConnection c = open(url);
        c.setRequestMethod("PUT");
        c.setDoOutput(true);
        c.setFixedLengthStreamingMode(body.length);
        c.setRequestProperty("Content-Type", "application/octet-stream");
        try {
            try (OutputStream out = c.getOutputStream()) {
                out.write(body);
            }
            int status = c.getResponseCode();
            if (status / 100 != 2) throw new IllegalStateException("PUT " + status);
        } finally {
            c.disconnect();
        }
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(60_000);
        c.setUseCaches(false);
        return c;
    }
}
