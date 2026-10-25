package com.wind.learningpack;

import org.json.JSONObject;

/** 计算测速：进位加法、退位减法、表内除法、带余除法各抽几题，屏幕键盘作答、计时；mode 为 guide 时只看背诵表和方法。界面在 assets/web/fact.html */
public class FactActivity extends WebActivity {
    @Override
    protected String page() {
        return "fact.html";
    }

    @Override
    protected Object handle(String method, JSONObject args) throws Exception {
        Store store = Store.get(this);
        switch (method) {
            case "mode":
                return getIntent().getStringExtra("mode") == null ? "" : getIntent().getStringExtra("mode");
            case "setup":
                return store.factSetup();
            case "save":
                store.saveFactRound(args);
                return true;
            default:
                throw new IllegalArgumentException("未知的方法：" + method);
        }
    }
}
