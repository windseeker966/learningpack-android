package com.wind.learningpack;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 这台手机上今天学了多久：做题、背单词、短文复习、计算测速的页面在前台（亮屏）的时间。
 * 每次同步交给 iPad（/pull 的 study），iPad 加进手机额度的学习码；规则同 iPad 的 StudyPacePolicy、StudyCode：
 * 一天从早上 5 点算起；离开不到 10 分钟接着算这段连续学习，否则重新算；一段连续学满 10 分钟算开始一次；
 * 两次计时之间最多记 120 秒（进程被挂起后醒来，不把挂起的时间都算进去）。
 * 当天累计存 SharedPreferences，进程被杀后接得上。各页面在主线程调用，同步服务在自己的线程读，方法全部同步。
 */
final class StudyTime {
    static final int DAY_START_HOUR = 5;
    static final long BREAK_RESETS_MS = 10 * 60_000L;
    static final long START_AFTER_MS = 10 * 60_000L;
    static final long MAX_TICK_MS = 120_000L;
    /** 页面在前台时多久记一次 */
    static final long TICK_MS = 30_000L;

    private static StudyTime instance;
    private final SharedPreferences prefs;
    /** 上次计时的时间；0 表示现在没有学习页面在前台 */
    private long lastTick;

    static synchronized StudyTime get(Context c) {
        if (instance == null) instance = new StudyTime(c.getApplicationContext());
        return instance;
    }

    private StudyTime(Context c) {
        prefs = c.getSharedPreferences("study_time", Context.MODE_PRIVATE);
    }

    static String dayKey(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(ms - DAY_START_HOUR * 3600_000L));
    }

    /** 学习页面回到前台：接上或重新开始这段连续学习 */
    synchronized void resume(long now) {
        long since = prefs.getLong("streakSince", 0);
        long lastActive = prefs.getLong("lastActive", 0);
        if (since == 0 || now - lastActive >= BREAK_RESETS_MS) {
            prefs.edit().putLong("streakSince", now).putLong("lastActive", now).apply();
        }
        lastTick = now;
        tick(now);
    }

    /** 学习页面退到后台、锁屏：记上最后一段 */
    synchronized void pause(long now) {
        if (lastTick == 0) return;
        tick(now);
        lastTick = 0;
    }

    /** 页面在前台时定时调；不在前台时只处理换天 */
    synchronized void tick(long now) {
        String day = dayKey(now);
        SharedPreferences.Editor e = prefs.edit();
        long ms = prefs.getLong("ms", 0);
        int starts = prefs.getInt("starts", 0);
        if (!day.equals(prefs.getString("day", ""))) {
            ms = 0;
            starts = 0;
            e.putString("day", day);
        }
        if (lastTick > 0) {
            ms += Math.min(Math.max(now - lastTick, 0), MAX_TICK_MS);
            lastTick = now;
            e.putLong("lastActive", now);
            long since = prefs.getLong("streakSince", now);
            if (now - since >= START_AFTER_MS && prefs.getLong("countedStreak", 0) != since) {
                e.putLong("countedStreak", since);
                starts++;
            }
        }
        e.putLong("ms", ms).putInt("starts", starts).apply();
    }

    /** 交给 iPad 的今天累计：{"day", "seconds", "starts"} */
    synchronized JSONObject today() throws Exception {
        tick(System.currentTimeMillis());
        return new JSONObject().put("day", prefs.getString("day", ""))
                .put("seconds", prefs.getLong("ms", 0) / 1000).put("starts", prefs.getInt("starts", 0));
    }

    synchronized long todaySeconds() {
        tick(System.currentTimeMillis());
        return prefs.getLong("ms", 0) / 1000;
    }
}
