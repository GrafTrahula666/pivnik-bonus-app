package ru.pivnik.evotor;

import android.content.Context;
import android.content.SharedPreferences;
import ru.pivnik.evotor.core.PosConfiguration;

/**
 * Separate POS identity. Staff sessions are never reused or migrated into a device key.
 */
final class BridgeSettings {
    private static final String PREFS = "pivnik_evotor_bridge";
    private static final String KEY_LAST_STATUS = "last_status";
    /** PIVNIK production server, so a fresh install only needs the till key typed in. */
    static final String DEFAULT_API_BASE = "https://pivnik-bonus-app-production-df60.up.railway.app";

    private final SharedPreferences prefs;
    private final DeviceCredentialStore credentials;

    BridgeSettings(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        credentials = new DeviceCredentialStore(prefs);
        prefs.edit().remove("staff_session_token").apply();
    }

    /** The server address is fixed: nobody types it, so a stray character can never break the connection. */
    String apiBaseUrl() {
        return DEFAULT_API_BASE;
    }

    String deviceToken() {
        return credentials.read(apiBaseUrl());
    }

    boolean isConfigured() {
        return PosConfiguration.validBase(apiBaseUrl()) && PosConfiguration.validToken(deviceToken());
    }

    void save(String deviceToken) {
        String base = apiBaseUrl();
        String token = deviceToken == null ? "" : deviceToken.trim();
        if (token.isEmpty()) token = deviceToken();
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
