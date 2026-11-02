package com.wind.learningpack;

import org.json.JSONArray;
import org.json.JSONObject;

/** 背说法卡：今天要背的卡（到期的、新放进来的、今天还要再背一次的），界面在 assets/web/phrase.html */
public class PhraseActivity extends WebActivity {
    @Override
    protected String page() {
        return "phrase.html";
    }

    @Override
    protected Object handle(String method, JSONObject args) throws Exception {
        Store store = Store.get(this);
        switch (method) {
            case "due":
                return new JSONArray(store.phraseDue());
            case "rate":
                store.addResult(new JSONObject().put("type", "phrase").put("key", args.getString("key"))
                        .put("rating", args.getInt("rating")).put("at", System.currentTimeMillis()), args.getString("key"));
                return true;
            default:
                throw new IllegalArgumentException("未知的方法：" + method);
        }
    }
}
