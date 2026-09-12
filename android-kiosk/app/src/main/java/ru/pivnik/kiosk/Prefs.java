package ru.pivnik.kiosk;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

public final class Prefs {
    public static final String VK_PACKAGE = "com.vkontakte.android";
    public static final String TG_PACKAGE = "org.telegram.messenger";
    private static final String FILE = "pivnik_kiosk";
    private Prefs() {}
    private static SharedPreferences p(Context c) { return c.getSharedPreferences(FILE, Context.MODE_PRIVATE); }
    public static boolean isKioskEnabled(Context c) { return p(c).getBoolean("kiosk_enabled", false); }
    public static void setKioskEnabled(Context c, boolean enabled) { p(c).edit().putBoolean("kiosk_enabled", enabled).apply(); }
    public static boolean hasPin(Context c) { return p(c).contains("pin_hash") && p(c).contains("pin_salt"); }
    public static void setPin(Context c, String pin) {
        byte[] salt = new byte[16]; new SecureRandom().nextBytes(salt);
        p(c).edit().putString("pin_salt", Base64.encodeToString(salt, Base64.NO_WRAP)).putString("pin_hash", hash(pin, salt)).apply();
    }
    public static boolean verifyPin(Context c, String pin) {
        String saltText = p(c).getString("pin_salt", null), saved = p(c).getString("pin_hash", null);
        if (saltText == null || saved == null) return false;
        return MessageDigest.isEqual(saved.getBytes(StandardCharsets.UTF_8), hash(pin, Base64.decode(saltText, Base64.NO_WRAP)).getBytes(StandardCharsets.UTF_8));
    }
    private static String hash(String pin, byte[] salt) {
        try { MessageDigest md = MessageDigest.getInstance("SHA-256"); md.update(salt); return Base64.encodeToString(md.digest(pin.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String getVkUri(Context c) { return p(c).getString("vk_uri", ""); }
    public static String getTgUri(Context c) { return p(c).getString("tg_uri", ""); }
    public static String getVpnPackage(Context c) { return p(c).getString("vpn_package", ""); }
    public static String getApiBaseUrl(Context c) { return p(c).getString("api_base_url", ""); }
    public static String getDeviceLabel(Context c) { return p(c).getString("device_label", "Пивник • Бар"); }
    public static void saveLinks(Context c, String vkUri, String tgUri, String vpnPackage) {
        p(c).edit().putString("vk_uri", clean(vkUri)).putString("tg_uri", clean(tgUri)).putString("vpn_package", clean(vpnPackage)).apply();
    }
    public static void saveServer(Context c, String apiBaseUrl, String deviceLabel) {
        String base = clean(apiBaseUrl).replaceAll("/+$", "");
        p(c).edit().putString("api_base_url", base).putString("device_label", clean(deviceLabel)).apply();
    }
    private static String clean(String v) { return v == null ? "" : v.trim(); }
}
