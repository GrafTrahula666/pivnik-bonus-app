package ru.pivnik.evotor;

import android.content.Context;
import android.content.SharedPreferences;
import ru.pivnik.evotor.core.PosConfiguration;

/**
 * Separate POS identity. Staff sessions are never reused or migrated into a device key.
 */
final class BridgeSettings {
    private static final String PREFS = "pivnik_evotor_bridge";
    private static final String KEY_API_BASE = "api_base_url";
    private static final String KEY_LAST_STATUS = "last_status";

    private final SharedPreferences prefs;
    private final DeviceCredentialStore credentials;

    BridgeSettings(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        credentials = new DeviceCredentialStore(prefs);
        prefs.edit().remove("staff_session_token").apply();
    }

    String apiBaseUrl() {
        String value = prefs.getString(KEY_API_BASE, "").trim();
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    String deviceToken() {
        return credentials.read(apiBaseUrl());
    }

    boolean isConfigured() {
        return PosConfiguration.validBase(apiBaseUrl()) && PosConfiguration.validToken(deviceToken());
    }

    void save(String apiBaseUrl, String deviceToken) {
        String base = apiBaseUrl == null ? "" : apiBaseUrl.trim();
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        String token = deviceToken == null ? "" : deviceToken.trim();
        if (token.isEmpty() && base.equals(apiBaseUrl())) token = deviceToken();
        if (!PosConfiguration.validBase(base) || !PosConfiguration.validToken(token)) {
            throw new IllegalArgumentException("Нужны HTTPS-адрес и отдельный ключ pvpos_… кассы.");
        }
        credentials.save(base, token);
    }

    void recordStatus(String status) {
        prefs.edit().putString(KEY_LAST_STATUS, System.currentTimeMillis() + " " + status).apply();
    }

    String lastStatus() {
        return prefs.getString(KEY_LAST_STATUS, "");
    }
}
