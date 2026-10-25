package com.wind.learningpack;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机、App 更新后启动同步服务 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            SyncService.start(context);
        } catch (Exception ignored) {
            // 后台启动前台服务受限时，等下次打开 App 再启动
        }
    }
}
