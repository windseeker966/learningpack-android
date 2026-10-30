package com.wind.learningpack;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 把学习时间报给手机上的「时间记录」App（time-tracker-android 的 AppEventProvider），换成手机额度：
 * 手机上学的（StudyTime 的当天累计）随学随报；iPad 上学的由 iPad 同步时推来（push 的 studyCode），这里原样转交，
 * 时间记录 App 用学习码的配对密钥核对校验码。时间记录 App 没装、没在运行时什么也不做。
 */
final class BudgetReport {
    private static final String TAG = "BudgetReport";
    private static final Uri PROVIDER = Uri.parse("content://com.wind.timetracker.events");
    /** 跨进程调用放到后台线程，按顺序执行 */
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private BudgetReport() { }

    static void phone(Context context, String day, long seconds, int starts) {
        Bundle b = new Bundle();
        b.putString("source", "phone");
        b.putString("day", day);
        b.putLong("seconds", seconds);
        b.putInt("starts", starts);
        send(context, b);
    }

    /** push 里的 studyCode：{"day", "minutes", "starts", "code"}；没有就跳过 */
    static void ipad(Context context, JSONObject studyCode) {
        if (studyCode == null) return;
        Bundle b = new Bundle();
        b.putString("source", "ipad");
        b.putString("day", studyCode.optString("day"));
        b.putInt("minutes", studyCode.optInt("minutes"));
        b.putInt("starts", studyCode.optInt("starts"));
        b.putString("code", studyCode.optString("code"));
        send(context, b);
    }

    private static void send(Context context, Bundle extras) {
        Context app = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                app.getContentResolver().call(PROVIDER, "study", null, extras);
            } catch (RuntimeException e) {
                Log.w(TAG, "report failed: " + e);
            }
        });
    }
}
