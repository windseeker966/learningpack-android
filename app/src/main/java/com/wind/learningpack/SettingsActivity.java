package com.wind.learningpack;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

/** 设置：和 iPad 配对的密钥、这台手机的地址、后台运行；AI 短文复习用的接口、地址、模型、API Key */
public class SettingsActivity extends Activity {
    private TextView secret, battery;
    private RadioButton anthropic, openai;
    private EditText base, model, key;
    private TextView result;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        box.setPadding(pad, pad, pad, pad);

        header(box, "和 iPad 配对");
        secret = new TextView(this);
        secret.setTextSize(24);
        secret.setTextIsSelectable(true);
        secret.setTypeface(android.graphics.Typeface.MONOSPACE);
        box.addView(secret);
        note(box, "把这串密钥填到 iPad 上 LearningPack 的「设置 › 手机复习」。iPad 打开 App 时自动来同步：宿舍里两台设备连同一个 Wi-Fi，在外面让 iPad 连这台手机的热点。");
        Button regenerate = new Button(this);
        regenerate.setText("重新生成密钥");
        regenerate.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setMessage("重新生成后，iPad 上要填新的密钥才能同步。")
                .setPositiveButton("重新生成", (d, w) -> { Auth.regenerate(this); show(); })
                .setNegativeButton("取消", null).show());
        box.addView(regenerate);

        TextView ips = new TextView(this);
        ips.setPadding(0, dp(8), 0, 0);
        ips.setAlpha(0.7f);
        String list = String.join("、", SyncService.localAddresses());
        ips.setText("这台手机现在的地址：" + (list.isEmpty() ? "没有连 Wi-Fi，也没开热点" : list)
                + "\niPad 找不到手机时，可以把地址填到 iPad 设置里。");
        box.addView(ips);

        battery = new TextView(this);
        battery.setPadding(0, dp(12), 0, 0);
        box.addView(battery);
        Button allow = new Button(this);
        allow.setText("允许在后台运行");
        allow.setOnClickListener(v -> requestBattery());
        box.addView(allow);
        note(box, "小米手机还要在「应用信息 › 省电策略」选「无限制」，并打开「自启动」，不然锁屏一会儿后 iPad 就连不上了。");
        Button details = new Button(this);
        details.setText("打开应用信息");
        details.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName()))));
        box.addView(details);

        header(box, "AI 短文复习");
        SharedPreferences p = Ai.prefs(this);
        RadioGroup group = new RadioGroup(this);
        anthropic = new RadioButton(this);
        anthropic.setText("Anthropic Messages API");
        anthropic.setId(android.view.View.generateViewId());
        openai = new RadioButton(this);
        openai.setText("OpenAI 兼容（Chat Completions）");
        openai.setId(android.view.View.generateViewId());
        group.addView(anthropic);
        group.addView(openai);
        box.addView(group);
        boolean isOpenAI = Ai.PROTO_OPENAI.equals(p.getString(Ai.KEY_PROTO, Ai.DEFAULT_PROTO));
        (isOpenAI ? openai : anthropic).setChecked(true);
        label(box, "地址");
        base = field(box, p.getString(Ai.KEY_BASE, Ai.DEFAULT_BASE), InputType.TYPE_TEXT_VARIATION_URI);
        label(box, "模型");
        model = field(box, p.getString(Ai.KEY_MODEL, Ai.DEFAULT_MODEL), InputType.TYPE_TEXT_VARIATION_NORMAL);
        label(box, "API Key");
        key = field(box, p.getString(Ai.KEY_API_KEY, ""), InputType.TYPE_TEXT_VARIATION_PASSWORD);
        note(box, "默认用 DeepSeek（和 iPad 上的 LearningPack 一样）。Key 只存在这台手机上，不会同步到 iPad。");
        LinearLayout buttons = new LinearLayout(this);
        Button save = new Button(this);
        save.setText("保存");
        save.setOnClickListener(v -> { save(); finish(); });
        Button test = new Button(this);
        test.setText("保存并测试");
        test.setOnClickListener(v -> { save(); test(); });
        buttons.addView(save);
        buttons.addView(test);
        box.addView(buttons);
        result = new TextView(this);
        result.setTextIsSelectable(true);
        box.addView(result);

        ScrollView scroll = new ScrollView(this);
        scroll.setFitsSystemWindows(true);
        scroll.addView(box);
        setContentView(scroll);
        show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        PowerManager pm = getSystemService(PowerManager.class);
        boolean ok = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        battery.setText(ok ? "后台运行：已允许" : "后台运行：未允许（锁屏后同步服务可能被系统停掉）");
    }

    private void show() {
        secret.setText(Auth.display(Auth.secret(this)));
    }

    @android.annotation.SuppressLint("BatteryLife")
    private void requestBattery() {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private void save() {
        Ai.prefs(this).edit()
                .putString(Ai.KEY_PROTO, openai.isChecked() ? Ai.PROTO_OPENAI : Ai.PROTO_ANTHROPIC)
                .putString(Ai.KEY_BASE, base.getText().toString().trim())
                .putString(Ai.KEY_MODEL, model.getText().toString().trim())
                .putString(Ai.KEY_API_KEY, key.getText().toString().trim())
                .apply();
    }

    private void test() {
        result.setText("测试中…");
        new Thread(() -> {
            String text;
            try {
                text = "成功：" + Ai.complete(this, "只回答「好」。", "测试", 50).text;
            } catch (Exception e) {
                text = e.getMessage();
            }
            String shown = text;
            runOnUiThread(() -> result.setText(shown));
        }).start();
    }

    private void header(LinearLayout box, String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(18);
        t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(20), 0, dp(8));
        box.addView(t);
    }

    private void note(LinearLayout box, String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setAlpha(0.6f);
        t.setPadding(0, dp(6), 0, dp(6));
        box.addView(t);
    }

    private void label(LinearLayout box, String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setPadding(0, dp(12), 0, dp(4));
        t.setAlpha(0.7f);
        box.addView(t);
    }

    private EditText field(LinearLayout box, String value, int variation) {
        EditText e = new EditText(this);
        e.setText(value);
        e.setSingleLine(true);
        e.setInputType(InputType.TYPE_CLASS_TEXT | variation);
        box.addView(e);
        return e;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density);
    }
}
