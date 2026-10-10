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
 * Device-key calls: POST /api/device/pos/qr/resolve (who is this QR) and
 * POST /api/device/pos/receipts/bind (this client was scanned into this open receipt).
 * The till never sends an amount: the server accrues from the closed cloud document.
 * Always runs off the Evotor binder thread.
 */
final class PivnikApi {
    private static final int TIMEOUT_MS = 3000;
    private static final int MAX_RESPONSE_CHARS = 64 * 1024;

    private PivnikApi() {}

    static ResolveResult resolve(BridgeSettings settings, String payload) {
        try {
            return post(settings, "/api/device/pos/qr/resolve", new JSONObject().put("payload", payload));
        } catch (JSONException error) {
            return ResolveResult.unavailable();
        }
    }

    /** Connection check from the setup screen: an unknown code answers 404 when the key is valid. */
    static ResolveResult check(BridgeSettings settings) {
        return resolve(settings, "PIVNIK-CONNECTION-CHECK");
    }

    static ResolveResult bind(BridgeSettings settings, String receiptUuid, String payload) {
        try {
            return post(settings, "/api/device/pos/receipts/bind",
                    new JSONObject().put("receiptUuid", receiptUuid).put("payload", payload));
        } catch (JSONException error) {
            return ResolveResult.unavailable();
        }
    }

    private static ResolveResult post(BridgeSettings settings, String path, JSONObject json) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(settings.apiBaseUrl() + path);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return ResolveResult.unavailable();
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Device " + settings.deviceToken());
            byte[] body = json.toString().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            return ResolveResult.fromHttp(status, read(stream));
        } catch (IOException | RuntimeException error) {
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
