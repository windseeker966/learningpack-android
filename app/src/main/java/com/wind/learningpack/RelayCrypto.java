package com.wind.learningpack;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 经中转服务器交换的数据块：信箱号和加密（协议见 PROTOCOL.md 的「中转」），必须和 iPad 的 PhoneRelayCrypto 一致：
 * 信箱号 = hex(HMAC-SHA256(配对密钥, "lp-relay-box")) 前 32 个字符；
 * 加密 = AES-256-GCM，密钥 HMAC-SHA256(配对密钥, "lp-relay-key")，结果 nonce(12) ‖ 密文 ‖ tag(16)，用途（up、down、img:<sha>）作附加数据。
 */
final class RelayCrypto {
    private static final SecureRandom RANDOM = new SecureRandom();

    private RelayCrypto() { }

    static String mailbox(String secret) {
        return Auth.hex(hmac(secret, "lp-relay-box")).substring(0, 32);
    }

    static byte[] seal(byte[] plain, String secret, String purpose) throws Exception {
        byte[] nonce = new byte[12];
        RANDOM.nextBytes(nonce);
        Cipher c = cipher(Cipher.ENCRYPT_MODE, secret, purpose, nonce);
        byte[] sealed = c.doFinal(plain);
        byte[] out = new byte[12 + sealed.length];
        System.arraycopy(nonce, 0, out, 0, 12);
        System.arraycopy(sealed, 0, out, 12, sealed.length);
        return out;
    }

    /** 密钥、用途不对或被改过时抛异常 */
    static byte[] open(byte[] block, String secret, String purpose) throws Exception {
        if (block.length < 28) throw new IllegalArgumentException("块太短");
        Cipher c = cipher(Cipher.DECRYPT_MODE, secret, purpose, Arrays.copyOfRange(block, 0, 12));
        return c.doFinal(block, 12, block.length - 12);
    }

    private static Cipher cipher(int mode, String secret, String purpose, byte[] nonce) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(mode, new SecretKeySpec(hmac(secret, "lp-relay-key"), "AES"), new GCMParameterSpec(128, nonce));
        c.updateAAD(purpose.getBytes(StandardCharsets.UTF_8));
        return c;
    }

    private static byte[] hmac(String secret, String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.US_ASCII), "HmacSHA256"));
            return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
