package ru.pivnik.evotor;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import java.io.InputStream;
import ru.pivnik.evotor.core.PosConfiguration;
import ru.pivnik.evotor.core.ProvisionedKey;

/**
 * Separate POS identity. Staff sessions are never reused or migrated into a device key.
 */
final class BridgeSettings {
    private static final String PREFS = "pivnik_evotor_bridge";
    private static final String KEY_LAST_STATUS = "last_status";
    /** Verified isolated Selectel ingress; the till key still authenticates at the main backend. */
    static final String DEFAULT_API_BASE = "https://139.100.238.159.nip.io/evotor";
    /** Exact previous AAD, used only to preserve an existing encrypted POS credential. */
    static final String LEGACY_API_BASE = "https://pivnik-bonus-app-production-df60.up.railway.app";

    private final SharedPreferences prefs;
    private final DeviceCredentialStore credentials;
    private final AssetManager assets;

    BridgeSettings(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        credentials = new DeviceCredentialStore(prefs);
        assets = context.getApplicationContext().getAssets();
        prefs.edit().remove("staff_session_token").apply();
    }

    /** The server address is fixed: nobody types it, so a stray character can never break the connection. */
    String apiBaseUrl() {
        return DEFAULT_API_BASE;
    }

    String deviceToken() {
        String token = credentials.read(apiBaseUrl());
        if (!token.isEmpty() || credentials.hasStoredCredential()) return token;
        // Only a privately delivered personal APK contains this optional asset.
        // Public CI/repository APKs never contain a real device credential.
        try (InputStream input = assets.open("pivnik-device-key.txt")) {
            token = ProvisionedKey.read(input);
            if (!token.isEmpty()) credentials.seedIfEmpty(apiBaseUrl(), token);
            return credentials.read(apiBaseUrl());
        } catch (Exception error) { return ""; }
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
