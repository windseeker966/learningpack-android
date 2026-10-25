package com.wind.learningpack;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 前台服务：开着同步用的 HTTP 服务（SyncServer），用 mDNS 广播 _lpreview._tcp，TXT 里写手机现在的局域网 IP。
 * 开关热点、换 Wi-Fi 后 IP 会变：每 20 秒看一次，变了就重新广播。
 */
public class SyncService extends Service {
    private static final String TAG = "SyncService";
    private static final String CHANNEL = "sync";
    static final String SERVICE_TYPE = "_lpreview._tcp";

    private SyncServer server;
    private NsdManager nsd;
    private NsdManager.RegistrationListener registration;
    private WifiManager.MulticastLock multicast;
    private String advertised = "";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable watch = new Runnable() {
        @Override public void run() {
            advertise();
            handler.postDelayed(this, 20_000);
        }
    };

    static void start(Context c) {
        Intent i = new Intent(c, SyncService.class);
        c.startForegroundService(i);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "和 iPad 同步", NotificationManager.IMPORTANCE_MIN));
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setContentTitle("等 iPad 来同步")
                .setContentText("iPad 打开 LearningPack 时自动同步复习题和作答")
                .setContentIntent(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                        PendingIntent.FLAG_IMMUTABLE))
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(1, n);
        }
        server = new SyncServer(this);
        server.start();
        nsd = getSystemService(NsdManager.class);
        WifiManager wifi = getSystemService(WifiManager.class);
        if (wifi != null) {
            multicast = wifi.createMulticastLock("lpreview");
            multicast.setReferenceCounted(false);
            multicast.acquire();
        }
        handler.post(watch);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(watch);
        unregister();
        if (server != null) server.stop();
        if (multicast != null && multicast.isHeld()) multicast.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** IP 变了（或还没广播）就重新广播 */
    private void advertise() {
        String ips = String.join(",", localAddresses());
        if (ips.equals(advertised) && registration != null) return;
        unregister();
        advertised = ips;
        if (ips.isEmpty()) return;
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName("LearningPack " + Build.MODEL);
        info.setServiceType(SERVICE_TYPE);
        info.setPort(SyncServer.PORT);
        info.setAttribute("ip", ips);
        info.setAttribute("v", "1");
        registration = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo s) { Log.i(TAG, "registered " + s.getServiceName() + " " + ips); }
            @Override public void onRegistrationFailed(NsdServiceInfo s, int error) {
                Log.w(TAG, "register failed " + error);
                registration = null;
                advertised = "";
            }
            @Override public void onServiceUnregistered(NsdServiceInfo s) {}
            @Override public void onUnregistrationFailed(NsdServiceInfo s, int error) {}
        };
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration);
        } catch (Exception e) {
            Log.w(TAG, "register error", e);
            registration = null;
            advertised = "";
        }
    }

    private void unregister() {
        if (registration == null) return;
        try { nsd.unregisterService(registration); } catch (Exception ignored) {}
        registration = null;
    }

    /**
     * 局域网 IPv4：Wi-Fi（wlan）的在前，热点（ap、swlan、wlan1 等）的在后；不含移动数据（rmnet、ccmni）、VPN（tun）等。
     * iPad 依次试这些地址
     */
    static List<String> localAddresses() {
        List<String> wifi = new ArrayList<>(), other = new ArrayList<>();
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                String name = nif.getName();
                if (name.matches("^(rmnet|r_rmnet|ccmni|dummy|tun|v4-|clat|ppp|wwan|ip6tnl|sit|p2p).*")) continue;
                for (InetAddress a : Collections.list(nif.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    (name.equals("wlan0") ? wifi : other).add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {
        }
        wifi.addAll(other);
        return wifi;
    }
}
