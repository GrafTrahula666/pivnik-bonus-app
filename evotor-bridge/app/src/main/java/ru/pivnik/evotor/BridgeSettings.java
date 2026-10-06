package ru.pivnik.evotor;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Bridge configuration. Prototype only: the till authenticates to the existing
 * {@code POST /api/staff/qr/resolve} with a staff member's own app session token pasted here
 * (valid up to the backend session TTL). A dedicated till credential is a separate, not yet
 * implemented backend contract — see evotor-bridge/BACKEND-CONTRACT.md.
 */
final class BridgeSettings {
    private static final String PREFS = "pivnik_evotor_bridge";
    private static final String KEY_API_BASE = "api_base_url";
    private static final String KEY_SESSION = "staff_session_token";
    private static final String KEY_LAST_STATUS = "last_status";

    private final SharedPreferences prefs;

    BridgeSettings(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    String apiBaseUrl() {
        String value = prefs.getString(KEY_API_BASE, "").trim();
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    String sessionToken() {
        return prefs.getString(KEY_SESSION, "").trim();
    }

    boolean isConfigured() {
        return apiBaseUrl().startsWith("https://") && !sessionToken().isEmpty();
    }

    void save(String apiBaseUrl, String sessionToken) {
        prefs.edit()
                .putString(KEY_API_BASE, apiBaseUrl == null ? "" : apiBaseUrl.trim())
                .putString(KEY_SESSION, sessionToken == null ? "" : sessionToken.trim())
                .apply();
    }

    void recordStatus(String status) {
        prefs.edit().putString(KEY_LAST_STATUS, System.currentTimeMillis() + " " + status).apply();
    }

    String lastStatus() {
        return prefs.getString(KEY_LAST_STATUS, "");
    }
}
