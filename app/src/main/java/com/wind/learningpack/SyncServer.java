package com.wind.learningpack;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 同步用的小 HTTP 服务（协议见 PROTOCOL.md）：一个请求一个连接，签名不对的一律 401。
 * iPad 每次同步：/pull 取走作答结果 → /push 确认并推来新的题单 → /image 补图片。
 */
final class SyncServer {
    static final int PORT = 47321;
    private static final String TAG = "SyncServer";
    private static final int MAX_BODY = 40 * 1024 * 1024;

    private final Context context;
    private ServerSocket server;
    private Thread thread;
    private volatile boolean running;
    /** 最近一次 iPad 来同步的时间（显示在首页） */
    static volatile long lastRequestAt;

    SyncServer(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized void start() {
        if (running) return;
        running = true;
        thread = new Thread(this::loop, "SyncServer");
        thread.start();
    }

    synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) {}
    }

    private void loop() {
        while (running) {
            try (ServerSocket s = new ServerSocket()) {
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(PORT));
                server = s;
                while (running) {
                    Socket socket = s.accept();
                    new Thread(() -> handle(socket), "SyncRequest").start();
                }
            } catch (IOException e) {
                if (!running) return;
                Log.w(TAG, "server error, retrying", e);
                try { Thread.sleep(3000); } catch (InterruptedException ignored) { return; }
            }
        }
    }

    private void handle(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(30_000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0], path = parts[1];
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) headers.put(line.substring(0, colon).trim().toLowerCase(Locale.US), line.substring(colon + 1).trim());
            }
            int length = 0;
            try { length = Integer.parseInt(headers.getOrDefault("content-length", "0")); } catch (NumberFormatException ignored) {}
            if (length < 0 || length > MAX_BODY) { respond(s, 413, "{\"error\":\"too large\"}"); return; }
            byte[] body = readFully(in, length);

            String secret = Auth.secret(context);
            long time;
            try { time = Long.parseLong(headers.getOrDefault("x-lp-time", "0")); } catch (NumberFormatException e) { time = 0; }
            String sign = headers.get("x-lp-sign");
            if (!Auth.isFresh(time, System.currentTimeMillis())
                    || !Auth.sameSignature(sign, Auth.requestSignature(secret, method, path, time, body))) {
                respond(s, 401, "{\"error\":\"unauthorized\"}");
                return;
            }
            lastRequestAt = System.currentTimeMillis();
            Store store = Store.get(context);
            String route = path.contains("?") ? path.substring(0, path.indexOf('?')) : path;
            switch (method + " " + route) {
                case "GET /ping":
                    respond(s, 200, new JSONObject().put("v", 1).put("pending", store.pendingCount()).toString());
                    break;
                case "POST /pull":
                    respond(s, 200, new JSONObject().put("v", 1).put("results", store.pendingResults())
                            .put("study", StudyTime.get(context).today()).toString());
                    break;
                case "POST /push": {
                    List<String> need = store.applyPush(new JSONObject(new String(body, StandardCharsets.UTF_8)));
                    respond(s, 200, new JSONObject().put("needImages", new JSONArray(need)).toString());
                    break;
                }
                case "POST /image": {
                    String sha = path.contains("sha=") ? path.substring(path.indexOf("sha=") + 4) : "";
                    boolean ok = store.saveImage(sha, body);
                    respond(s, ok ? 200 : 400, new JSONObject().put("ok", ok).toString());
                    break;
                }
                default:
                    respond(s, 404, "{\"error\":\"not found\"}");
            }
        } catch (Exception e) {
            Log.w(TAG, "request failed", e);
        }
    }

    private void respond(Socket s, int status, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        long time = System.currentTimeMillis();
        String sign = Auth.responseSignature(Auth.secret(context), time, body);
        String head = "HTTP/1.1 " + status + " " + reason(status) + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n"
                + "X-LP-Time: " + time + "\r\n"
                + "X-LP-Sign: " + sign + "\r\n\r\n";
        OutputStream out = s.getOutputStream();
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
        s.shutdownOutput();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 404: return "Not Found";
            case 413: return "Payload Too Large";
            default: return "Error";
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 16 * 1024) throw new IOException("header too long");
        }
        if (c == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] buf = new byte[length];
        int off = 0;
        while (off < length) {
            int n = in.read(buf, off, length - off);
            if (n < 0) throw new IOException("unexpected end of body");
            off += n;
        }
        return buf;
    }
}
