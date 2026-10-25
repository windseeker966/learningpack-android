package com.wind.learningpack;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.Locale;

/**
 * 做题、背单词、AI 短文复习的界面都是网页（assets/web/），公式用 KaTeX 显示。
 * 网页从 https://lp.local/web/… 读 assets，从 https://lp.local/img/<sha> 读 iPad 推来的图片（都在这里拦下，不联网）。
 * 网页通过 window.Android.call / callAsync 调这里；子类在 handle 里处理各自的方法。
 * App 退到后台、锁屏时通知网页（lpVisible(false)），用来暂停作答计时
 */
public abstract class WebActivity extends Activity {
    private static final String HOST = "lp.local";
    protected WebView web;
    private TextToSpeech tts;
    private final Handler main = new Handler(Looper.getMainLooper());

    /** assets/web/ 下的页面，如 review.html */
    protected abstract String page();

    /** 网页调来的方法；返回值转成字符串交给网页（JSON） */
    protected abstract Object handle(String method, JSONObject args) throws Exception;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!HOST.equals(request.getUrl().getHost())) return null;
                String path = request.getUrl().getPath();
                if (path == null) return null;
                try {
                    if (path.startsWith("/web/")) {
                        InputStream in = getAssets().open(path.substring(1));
                        return new WebResourceResponse(mime(path), "utf-8", in);
                    }
                    if (path.startsWith("/img/")) {
                        File f = Store.get(WebActivity.this).image(path.substring(5));
                        if (f.exists()) return new WebResourceResponse(sniff(f), null, new FileInputStream(f));
                    }
                } catch (Exception ignored) {
                }
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(insetContainer(web));
        web.loadUrl("https://" + HOST + "/web/" + page());
    }

    /**
     * Android 15 起内容默认延伸到状态栏、导航栏下面，WebView 不会自己让开：外面套一层，按系统栏、
     * 刘海和键盘的大小留出空白（底色同网页的 --bg）
     */
    private FrameLayout insetContainer(WebView child) {
        FrameLayout box = new FrameLayout(this);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        box.setBackgroundColor(dark ? Color.rgb(0x11, 0x11, 0x13) : Color.rgb(0xf6, 0xf6, 0xf4));
        if (!dark && Build.VERSION.SDK_INT >= 30) {
            // 浅色底上状态栏、导航栏用深色图标
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(light, light);
        }
        box.addView(child, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        box.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        return box;
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.evaluateJavascript("window.lpVisible && lpVisible(true)", null);
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.lpVisible && lpVisible(false)", null);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // 网页自己决定返回键做什么（如先收起），没处理就关掉
        web.evaluateJavascript("window.lpBack ? lpBack() : false", value -> {
            if (!"true".equals(value)) finish();
        });
    }

    protected void speak(String text) {
        if (tts == null) {
            tts = new TextToSpeech(this, status -> {
                if (status == TextToSpeech.SUCCESS) {
                    tts.setLanguage(Locale.US);
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lp");
                }
            });
        } else {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lp");
        }
    }

    private Object common(String method, JSONObject args) {
        switch (method) {
            case "speak": speak(args.optString("text")); return true;
            case "close": main.post(this::finish); return true;
            default: return null;
        }
    }

    private final class Bridge {
        @JavascriptInterface
        public String call(String method, String args) {
            try {
                JSONObject a = new JSONObject(args == null || args.isEmpty() ? "{}" : args);
                Object r = common(method, a);
                if (r == null) r = handle(method, a);
                return new JSONObject().put("ok", true).put("value", r == null ? JSONObject.NULL : r).toString();
            } catch (Exception e) {
                return error(e);
            }
        }

        /** 放到后台线程里做（如请求 AI），做完调网页的 lpResolve(id, 结果) */
        @JavascriptInterface
        public void callAsync(String method, String args, String id) {
            new Thread(() -> {
                String result = call(method, args);
                main.post(() -> web.evaluateJavascript("lpResolve(" + JSONObject.quote(id) + "," + result + ")", null));
            }).start();
        }
    }

    private static String error(Exception e) {
        try {
            String m = e.getMessage() == null ? e.toString() : e.getMessage();
            return new JSONObject().put("ok", false).put("error", m).toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"出错了\"}";
        }
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    /** 图片按开头几个字节判断格式（存的时候只按哈希命名） */
    private static String sniff(File f) {
        byte[] b = new byte[4];
        try (FileInputStream in = new FileInputStream(f)) {
            if (in.read(b) < 4) return "application/octet-stream";
        } catch (Exception e) {
            return "application/octet-stream";
        }
        if ((b[0] & 0xff) == 0x89 && b[1] == 'P') return "image/png";
        if ((b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8) return "image/jpeg";
        if (b[0] == 'G' && b[1] == 'I') return "image/gif";
        if (b[0] == 'R' && b[1] == 'I') return "image/webp";
        if (b[0] == '<') return "image/svg+xml";
        return "application/octet-stream";
    }
}
