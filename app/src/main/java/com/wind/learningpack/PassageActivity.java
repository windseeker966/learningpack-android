package com.wind.learningpack;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/** 生词的 AI 短文复习（同 iPad 上的 VocabPassageSession），界面在 assets/web/passage.html */
public class PassageActivity extends WebActivity {
    /** 一篇短文挑的词数、背过的词少于这么多时不能做（同 iPad） */
    static final int WORD_COUNT = 12;
    static final int MINIMUM = 3;

    @Override
    protected String page() {
        return "passage.html";
    }

    @Override
    protected Object handle(String method, JSONObject args) throws Exception {
        Store store = Store.get(this);
        switch (method) {
            case "configured":
                return Ai.configured(this);
            case "pick": {
                // 从背过的词里随机挑，最近一小时 AI 短文里挑过的不挑
                Set<String> recent = store.recentPassageKeys();
                List<JSONObject> pool = new ArrayList<>();
                for (JSONObject e : store.vocabPool()) if (!recent.contains(e.optString("key"))) pool.add(e);
                Collections.shuffle(pool);
                JSONArray out = new JSONArray();
                for (int i = 0; i < Math.min(WORD_COUNT, pool.size()); i++) out.put(pool.get(i));
                return out.length() < MINIMUM ? new JSONArray() : out;
            }
            case "ai": {
                String system = "grade".equals(args.optString("kind")) ? Ai.GRADING_SYSTEM : Ai.PASSAGE_SYSTEM;
                Ai.Completion c = Ai.complete(this, system, args.getString("user"), 1500);
                return new JSONObject().put("text", c.text).put("usage", c.usage);
            }
            case "remember":
                store.rememberPassage(args.getJSONArray("keys"));
                return true;
            case "confirm":
                store.addResult(args.getJSONObject("result"), null);
                return true;
            default:
                throw new IllegalArgumentException("未知的方法：" + method);
        }
    }
}
