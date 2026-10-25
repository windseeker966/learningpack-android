package com.wind.learningpack;

import android.content.Context;
import android.content.SharedPreferences;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * 配对密钥和请求签名，和 iPad 上 LearningPack 的 PhoneSyncAuth 一样（见 PROTOCOL.md）。
 * 密钥在这台手机上生成：16 个 Base32 字符，显示成 XXXX-XXXX-XXXX-XXXX，填到 iPad 设置里。
 */
final class Auth {
    static final long MAX_SKEW_MS = 300_000;
    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final String KEY_SECRET = "secret";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("auth", Context.MODE_PRIVATE);
    }

    /** 配对密钥；第一次用时生成 */
    static synchronized String secret(Context c) {
        String s = prefs(c).getString(KEY_SECRET, null);
        if (s == null || s.length() != 16) {
            s = newSecret();
            prefs(c).edit().putString(KEY_SECRET, s).apply();
        }
        return s;
    }

    static synchronized String regenerate(Context c) {
        String s = newSecret();
        prefs(c).edit().putString(KEY_SECRET, s).apply();
        return s;
    }

    static String newSecret() {
        SecureRandom r = new SecureRandom();
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < 16; i++) s.append(ALPHABET.charAt(r.nextInt(32)));
        return s.toString();
    }

    /** ABCD-EFGH-IJKL-MNOP */
    static String display(String secret) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < secret.length(); i++) {
            if (i > 0 && i % 4 == 0) s.append('-');
            s.append(secret.charAt(i));
        }
        return s.toString();
    }

    static String sha256Hex(byte[] data) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String hmacHex(String secret, String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.US_ASCII), "HmacSHA256"));
            return hex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** 请求的签名：方法、路径（含查询串）、时间（Unix 毫秒）、请求体的 SHA-256 */
    static String requestSignature(String secret, String method, String path, long time, byte[] body) {
        return hmacHex(secret, method + "\n" + path + "\n" + time + "\n" + sha256Hex(body));
    }

    /** 响应的签名：时间（Unix 毫秒）、响应体的 SHA-256 */
    static String responseSignature(String secret, long time, byte[] body) {
        return hmacHex(secret, "response\n" + time + "\n" + sha256Hex(body));
    }

    static boolean isFresh(long time, long now) {
        return Math.abs(now - time) <= MAX_SKEW_MS;
    }

    /** 两个签名逐字节比较，用时不随前缀长短变化 */
    static boolean sameSignature(String a, String b) {
        if (a == null || b == null) return false;
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII), b.getBytes(StandardCharsets.US_ASCII));
    }

    static String hex(byte[] bytes) {
        StringBuilder s = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) s.append(String.format("%02x", b));
        return s.toString();
    }

    private Auth() {}
}
