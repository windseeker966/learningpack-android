package com.wind.learningpack;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 这台手机上的数据：iPad 推来的今天的复习题和单词、计算测速的各事实成绩（每次推送整个替换）、还没被 iPad 取走的作答结果、跳过的题、图片。
 * 作答结果被 iPad 确认（ack）后就删掉：iPad 上的 LearningPack 才是权威数据。
 */
final class Store extends SQLiteOpenHelper {
    private static Store instance;
    private final Context app;
    private static final List<Runnable> listeners = new CopyOnWriteArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());

    static synchronized Store get(Context c) {
        if (instance == null) instance = new Store(c.getApplicationContext());
        return instance;
    }

    private Store(Context c) {
        super(c, "learningpack.db", null, 1);
        app = c;
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE questions (key TEXT PRIMARY KEY, ord INTEGER, json TEXT)");
        db.execSQL("CREATE TABLE vocab_due (key TEXT PRIMARY KEY, ord INTEGER, json TEXT)");
        db.execSQL("CREATE TABLE vocab_pool (key TEXT PRIMARY KEY, json TEXT)");
        db.execSQL("CREATE TABLE results (id TEXT PRIMARY KEY, type TEXT, item_key TEXT, at INTEGER, json TEXT)");
        db.execSQL("CREATE TABLE skips (key TEXT PRIMARY KEY, day TEXT, forever INTEGER)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

    SharedPreferences prefs() {
        return app.getSharedPreferences("sync", Context.MODE_PRIVATE);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    // ---- 变化通知（首页、做题页刷新）----

    static void addListener(Runnable r) { listeners.add(r); }

    static void removeListener(Runnable r) { listeners.remove(r); }

    private static void changed() {
        main.post(() -> { for (Runnable r : listeners) r.run(); });
    }

    // ---- iPad 推送 ----

    /** 用推来的题单和单词替换旧的，删掉 iPad 已确认的结果；返回手机上还没有的图片 */
    synchronized List<String> applyPush(JSONObject push) throws Exception {
        SQLiteDatabase db = getWritableDatabase();
        Set<String> need = new HashSet<>();
        db.beginTransaction();
        try {
            JSONArray ack = push.optJSONArray("ack");
            if (ack != null) {
                for (int i = 0; i < ack.length(); i++) db.delete("results", "id = ?", new String[]{ack.getString(i)});
            }
            db.delete("questions", null, null);
            JSONArray qs = push.optJSONArray("questions");
            if (qs != null) {
                for (int i = 0; i < qs.length(); i++) {
                    JSONObject q = qs.getJSONObject(i);
                    ContentValues v = new ContentValues();
                    v.put("key", q.getString("key"));
                    v.put("ord", i);
                    v.put("json", q.toString());
                    db.insertWithOnConflict("questions", null, v, SQLiteDatabase.CONFLICT_REPLACE);
                    JSONObject images = q.optJSONObject("images");
                    if (images != null) {
                        for (java.util.Iterator<String> it = images.keys(); it.hasNext(); ) {
                            JSONObject img = images.optJSONObject(it.next());
                            String sha = img == null ? null : img.optString("sha", null);
                            if (sha != null && !image(sha).exists()) need.add(sha);
                        }
                    }
                }
            }
            JSONObject vocab = push.optJSONObject("vocab");
            db.delete("vocab_due", null, null);
            db.delete("vocab_pool", null, null);
            if (vocab != null) {
                JSONArray due = vocab.optJSONArray("due");
                for (int i = 0; due != null && i < due.length(); i++) {
                    JSONObject e = due.getJSONObject(i);
                    ContentValues v = new ContentValues();
                    v.put("key", e.getString("key"));
                    v.put("ord", i);
                    v.put("json", e.toString());
                    db.insertWithOnConflict("vocab_due", null, v, SQLiteDatabase.CONFLICT_REPLACE);
                }
                JSONArray pool = vocab.optJSONArray("pool");
                for (int i = 0; pool != null && i < pool.length(); i++) {
                    JSONObject e = pool.getJSONObject(i);
                    ContentValues v = new ContentValues();
                    v.put("key", e.getString("key"));
                    v.put("json", e.toString());
                    db.insertWithOnConflict("vocab_pool", null, v, SQLiteDatabase.CONFLICT_REPLACE);
                }
            }
            db.delete("skips", "forever = 0 AND day != ?", new String[]{today()});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        JSONArray recent = push.optJSONObject("vocab") == null ? new JSONArray()
                : push.getJSONObject("vocab").optJSONArray("recentPassageKeys");
        prefs().edit()
                .putString("day", push.optString("day", today()))
                .putLong("generatedAt", push.optLong("generatedAt"))
                .putLong("lastSync", System.currentTimeMillis())
                .putString("recentPassageKeys", recent == null ? "[]" : recent.toString())
                .putString("facts", push.optJSONObject("facts") == null ? "{}" : push.getJSONObject("facts").toString())
                .putFloat("retention", (float) push.optDouble("retention", 0.9))
                .apply();
        changed();
        return new ArrayList<>(need);
    }

    File image(String sha) {
        File dir = new File(app.getFilesDir(), "images");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, sha.replaceAll("[^0-9a-f]", ""));
    }

    /** 收到图片：哈希对得上才存 */
    boolean saveImage(String sha, byte[] data) {
        if (!Auth.sha256Hex(data).equals(sha)) return false;
        File f = image(sha);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(data);
        } catch (Exception e) {
            return false;
        }
        changed();
        return true;
    }

    // ---- 作答结果 ----

    synchronized void addResult(JSONObject result, String itemKey) throws Exception {
        if (!result.has("id")) result.put("id", UUID.randomUUID().toString());
        ContentValues v = new ContentValues();
        v.put("id", result.getString("id"));
        v.put("type", result.getString("type"));
        v.put("item_key", itemKey);
        v.put("at", System.currentTimeMillis());
        v.put("json", result.toString());
        getWritableDatabase().insertWithOnConflict("results", null, v, SQLiteDatabase.CONFLICT_REPLACE);
        changed();
    }

    /** 还没被 iPad 确认的全部结果，按时间先后 */
    synchronized JSONArray pendingResults() throws Exception {
        JSONArray out = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT json FROM results ORDER BY at", null)) {
            while (c.moveToNext()) out.put(new JSONObject(c.getString(0)));
        }
        return out;
    }

    int pendingCount() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM results", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    private Set<String> pendingKeys(String... types) {
        Set<String> keys = new HashSet<>();
        StringBuilder in = new StringBuilder();
        for (int i = 0; i < types.length; i++) in.append(i == 0 ? "?" : ",?");
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT item_key FROM results WHERE type IN (" + in + ")", types)) {
            while (c.moveToNext()) if (c.getString(0) != null) keys.add(c.getString(0));
        }
        return keys;
    }

    // ---- 复习题 ----

    /** 推送是今天的才用；昨天推的题单今天不做，等 iPad 推新的 */
    boolean pushIsToday() {
        return today().equals(prefs().getString("day", ""));
    }

    /** 今天还要做的题：做过（结果还没被取走）的、跳过的不算 */
    synchronized List<JSONObject> reviewQueue() throws Exception {
        List<JSONObject> out = new ArrayList<>();
        if (!pushIsToday()) return out;
        Set<String> done = pendingKeys("choice", "blank", "skip");
        Set<String> skipped = new HashSet<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT key FROM skips WHERE forever = 1 OR day = ?",
                new String[]{today()})) {
            while (c.moveToNext()) skipped.add(c.getString(0));
        }
        try (Cursor c = getReadableDatabase().rawQuery("SELECT key, json FROM questions ORDER BY ord", null)) {
            while (c.moveToNext()) {
                String key = c.getString(0);
                if (done.contains(key) || skipped.contains(key)) continue;
                out.add(new JSONObject(c.getString(1)));
            }
        }
        return out;
    }

    synchronized void skip(String key, boolean forever) {
        ContentValues v = new ContentValues();
        v.put("key", key);
        v.put("day", today());
        v.put("forever", forever ? 1 : 0);
        getWritableDatabase().insertWithOnConflict("skips", null, v, SQLiteDatabase.CONFLICT_REPLACE);
        changed();
    }

    // ---- 单词 ----

    /** 今天要背的词：这台手机上背过（结果还没被取走）的不算 */
    synchronized List<JSONObject> vocabDue() throws Exception {
        List<JSONObject> out = new ArrayList<>();
        if (!pushIsToday()) return out;
        Set<String> done = pendingKeys("vocab");
        try (Cursor c = getReadableDatabase().rawQuery("SELECT key, json FROM vocab_due ORDER BY ord", null)) {
            while (c.moveToNext()) if (!done.contains(c.getString(0))) out.add(new JSONObject(c.getString(1)));
        }
        return out;
    }

    synchronized List<JSONObject> vocabPool() throws Exception {
        List<JSONObject> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT json FROM vocab_pool", null)) {
            while (c.moveToNext()) out.add(new JSONObject(c.getString(0)));
        }
        return out;
    }

    /** 最近一小时 AI 短文里挑过的词：iPad 推来的，加上这台手机上写过的 */
    Set<String> recentPassageKeys() {
        Set<String> keys = new HashSet<>();
        try {
            JSONArray a = new JSONArray(prefs().getString("recentPassageKeys", "[]"));
            for (int i = 0; i < a.length(); i++) keys.add(a.getString(i));
            JSONArray local = new JSONArray(prefs().getString("localPassages", "[]"));
            long since = System.currentTimeMillis() - 3600_000;
            for (int i = 0; i < local.length(); i++) {
                JSONObject p = local.getJSONObject(i);
                if (p.getLong("at") < since) continue;
                JSONArray k = p.getJSONArray("keys");
                for (int j = 0; j < k.length(); j++) keys.add(k.getString(j));
            }
        } catch (Exception ignored) {
        }
        return keys;
    }

    void rememberPassage(JSONArray keys) {
        try {
            JSONArray local = new JSONArray(prefs().getString("localPassages", "[]"));
            JSONArray kept = new JSONArray();
            long since = System.currentTimeMillis() - 3600_000;
            for (int i = 0; i < local.length(); i++) {
                if (local.getJSONObject(i).getLong("at") >= since) kept.put(local.getJSONObject(i));
            }
            kept.put(new JSONObject().put("at", System.currentTimeMillis()).put("keys", keys));
            prefs().edit().putString("localPassages", kept.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    // ---- 计算测速 ----

    /**
     * 抽题用的：每类几题、今天测过没有、每个事实最近一次的成绩（iPad 推来的，再用这台手机上还没被取走的轮次覆盖），
     * 规则同 iPad 的 ArithmeticFacts（手机按同样的规则自己抽题）
     */
    synchronized JSONObject factSetup() throws Exception {
        JSONObject facts = new JSONObject(prefs().getString("facts", "{}"));
        JSONObject stats = facts.optJSONObject("stats");
        if (stats == null) stats = new JSONObject();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT json FROM results WHERE type = 'fact' ORDER BY at", null)) {
            while (c.moveToNext()) {
                JSONArray rs = new JSONObject(c.getString(0)).optJSONArray("results");
                for (int i = 0; rs != null && i < rs.length(); i++) {
                    JSONObject r = rs.getJSONObject(i);
                    if (r.optBoolean("retry")) continue;
                    stats.put(r.getString("key"), new JSONObject().put("seconds", r.getDouble("seconds"))
                            .put("correct", r.getBoolean("correct")));
                }
            }
        }
        JSONObject out = new JSONObject().put("perKind", facts.optInt("perKind", 10)).put("stats", stats)
                .put("doneToday", factDoneToday());
        JSONObject progress = new JSONObject(prefs().getString("factProgress", "{}"));
        if (today().equals(progress.optString("day"))) out.put("progress", progress);
        return out;
    }

    /** 今天测完过一轮：iPad 上测过（今天推来的），或这台手机上测完过 */
    boolean factDoneToday() {
        try {
            if (pushIsToday() && new JSONObject(prefs().getString("facts", "{}")).optBoolean("doneToday")) return true;
        } catch (Exception ignored) {
        }
        return today().equals(prefs().getString("factDoneDay", ""));
    }

    /**
     * 记一轮测速（PROTOCOL.md 的 fact），每答一题存一次，同一轮用同一个 id 覆盖。
     * 还没做的题（pending）只存在本机，当天再打开时接着做；做完（finishedAt 有值）清掉
     */
    void saveFactRound(JSONObject round) throws Exception {
        JSONArray pending = round.optJSONArray("pending");
        round.remove("pending");
        SharedPreferences.Editor e = prefs().edit();
        if (round.isNull("finishedAt") && pending != null && pending.length() > 0) {
            e.putString("factProgress", new JSONObject(round.toString()).put("pending", pending).put("day", today()).toString());
        } else {
            e.remove("factProgress");
        }
        if (!round.isNull("finishedAt")) e.putString("factDoneDay", today());
        e.apply();
        if (round.optJSONArray("results") == null || round.getJSONArray("results").length() == 0) return;
        round.put("type", "fact");
        addResult(round, null);
    }

    /** 今天没做完的一轮还剩几题；没有为 0 */
    int factRemaining() {
        try {
            JSONObject p = new JSONObject(prefs().getString("factProgress", "{}"));
            return today().equals(p.optString("day")) ? p.getJSONArray("pending").length() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    // ---- 学习会话（同 iPad：相邻两次作答间隔超过 30 分钟算新的会话）----

    synchronized JSONObject nextSession(long workStarted) {
        SharedPreferences p = app.getSharedPreferences("session", Context.MODE_PRIVATE);
        String id = p.getString("id", null);
        int index = p.getInt("index", 0);
        long last = p.getLong("last", 0);
        if (id == null || workStarted - last >= 30 * 60_000L) {
            id = "phone-" + UUID.randomUUID();
            index = 0;
        }
        index++;
        p.edit().putString("id", id).putInt("index", index).putLong("last", System.currentTimeMillis()).apply();
        try {
            return new JSONObject().put("sessionID", id).put("sessionIndex", index);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
