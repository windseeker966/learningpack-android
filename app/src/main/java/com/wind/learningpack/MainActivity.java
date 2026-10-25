package com.wind.learningpack;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.Date;
import java.util.List;

/** 首页：今天还有几道复习题、几个词，和 iPad 上次同步的时间；同步服务在这里启动 */
public class MainActivity extends Activity {
    private TextView status, hint;
    private Button review, vocab, passage;
    private final Runnable refresh = this::refresh;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SyncService.start(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        box.setPadding(pad, pad, pad, pad);

        review = bigButton(box, v -> startActivity(new Intent(this, ReviewActivity.class)));
        vocab = bigButton(box, v -> startActivity(new Intent(this, VocabActivity.class)));
        passage = bigButton(box, v -> startActivity(new Intent(this, PassageActivity.class)));
        passage.setText("AI 短文复习生词");

        hint = new TextView(this);
        hint.setPadding(0, dp(16), 0, 0);
        hint.setAlpha(0.75f);
        box.addView(hint);

        status = new TextView(this);
        status.setPadding(0, dp(16), 0, 0);
        status.setAlpha(0.6f);
        status.setTextSize(13);
        box.addView(status);

        ScrollView scroll = new ScrollView(this);
        scroll.setFitsSystemWindows(true);
        scroll.addView(box);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Store.addListener(refresh);
        refresh();
    }

    @Override
    protected void onPause() {
        Store.removeListener(refresh);
        super.onPause();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "设置").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 1) {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void refresh() {
        Store store = Store.get(this);
        int questions = 0, words = 0;
        double seconds = 0;
        try {
            List<JSONObject> q = store.reviewQueue();
            questions = q.size();
            for (JSONObject o : q) seconds += o.optDouble("estimatedSeconds", 30);
            words = store.vocabDue().size();
        } catch (Exception ignored) {
        }
        review.setText(questions > 0
                ? "做复习题  " + questions + " 道 · 约 " + Math.max(1, Math.round(seconds / 60)) + " 分钟"
                : "复习题都做完了");
        review.setEnabled(questions > 0);
        vocab.setText(words > 0 ? "背单词  " + words + " 个" : "今天的单词背完了");
        vocab.setEnabled(words > 0);

        long last = store.prefs().getLong("lastSync", 0);
        int pending = store.pendingCount();
        StringBuilder s = new StringBuilder();
        s.append(last == 0 ? "还没和 iPad 同步过" : "上次和 iPad 同步：" + time(last));
        if (pending > 0) s.append("\n还有 ").append(pending).append(" 条作答等 iPad 取走");
        status.setText(s);
        hint.setText(store.pushIsToday() ? ""
                : "今天还没和 iPad 同步：打开 iPad 上的 LearningPack，两台设备连同一个 Wi-Fi，或让 iPad 连这台手机的热点。"
                + (last == 0 ? "第一次用先在「设置」里看配对密钥，填到 iPad 的设置 › 手机复习。" : ""));
    }

    private String time(long ms) {
        Date d = new Date(ms);
        boolean today = android.text.format.DateUtils.isToday(ms);
        return (today ? "今天 " : DateFormat.format("M月d日 ", d)) + DateFormat.format("HH:mm", d).toString();
    }

    private Button bigButton(LinearLayout box, android.view.View.OnClickListener l) {
        Button b = new Button(this);
        b.setTextSize(18);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setGravity(Gravity.CENTER);
        b.setMinHeight(dp(72));
        b.setAllCaps(false);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(12);
        box.addView(b, lp);
        return b;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }
}
