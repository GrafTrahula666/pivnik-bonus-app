package ru.pivnik.evotor;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;
import ru.pivnik.evotor.core.ResolveResult;

/**
 * Calls the existing PIVNIK resolver, POST /api/staff/qr/resolve (universal-server.js), which
 * runs the canonical qr-resolver.js lookup (revoked aliases excluded). Read-only for the till:
 * it does not accrue or spend anything. Always runs off the Evotor binder thread.
 */
final class PivnikApi {
    private static final int TIMEOUT_MS = 3000;
    private static final int MAX_RESPONSE_CHARS = 64 * 1024;

    private PivnikApi() {}

    static ResolveResult resolve(BridgeSettings settings, String payload) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(settings.apiBaseUrl() + "/api/staff/qr/resolve");
            if (!"https".equalsIgnoreCase(url.getProtocol())) return ResolveResult.unavailable();
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Bearer " + settings.sessionToken());
            byte[] body = new JSONObject().put("payload", payload).toString().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            return ResolveResult.fromHttp(status, read(stream));
        } catch (IOException | JSONException | RuntimeException error) {
            return ResolveResult.unavailable();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String read(InputStream input) throws IOException {
        if (input == null) return null;
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            char[] buffer = new char[4096];
            int count;
            while ((count = reader.read(buffer)) != -1) {
                if (result.length() + count > MAX_RESPONSE_CHARS) return null;
                result.append(buffer, 0, count);
            }
        }
        return result.toString();
    }
}
