package com.wind.learningpack;

import org.json.JSONArray;
import org.json.JSONObject;

/** 背单词：今天要背的词（到期的旧词和今天的新词），界面在 assets/web/vocab.html */
public class VocabActivity extends WebActivity {
    @Override
    protected String page() {
        return "vocab.html";
    }

    @Override
    protected Object handle(String method, JSONObject args) throws Exception {
        Store store = Store.get(this);
        switch (method) {
            case "due":
                return new JSONArray(store.vocabDue());
            case "rate":
                store.addResult(new JSONObject().put("type", "vocab").put("key", args.getString("key"))
                        .put("rating", args.getInt("rating")).put("at", System.currentTimeMillis()), args.getString("key"));
                return true;
            default:
                throw new IllegalArgumentException("未知的方法：" + method);
        }
    }
}
