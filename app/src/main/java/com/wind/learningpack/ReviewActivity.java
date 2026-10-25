package com.wind.learningpack;

import org.json.JSONArray;
import org.json.JSONObject;

/** 做今天的复习题（选择题、填空题），界面在 assets/web/review.html；首页「做一大组」进来时第一组 10 道 */
public class ReviewActivity extends WebActivity {
    static final String EXTRA_BLOCK = "block";

    @Override
    protected String page() {
        return "review.html";
    }

    @Override
    protected Object handle(String method, JSONObject args) throws Exception {
        Store store = Store.get(this);
        switch (method) {
            case "options":
                return new JSONObject().put("block", getIntent().getIntExtra(EXTRA_BLOCK, 0));
            case "queue":
                return new JSONArray(store.reviewQueue());
            case "session":
                return store.nextSession(args.optLong("workStarted", System.currentTimeMillis()));
            case "submit":
                store.addResult(args.getJSONObject("result"), args.getString("key"));
                return true;
            case "skip": {
                boolean forever = args.optBoolean("forever");
                store.skip(args.getString("key"), forever);
                store.addResult(new JSONObject().put("type", "skip").put("pack", args.optString("pack"))
                        .put("question", args.optString("question")).put("at", System.currentTimeMillis())
                        .put("forever", forever), args.getString("key"));
                return true;
            }
            default:
                throw new IllegalArgumentException("未知的方法：" + method);
        }
    }
}
