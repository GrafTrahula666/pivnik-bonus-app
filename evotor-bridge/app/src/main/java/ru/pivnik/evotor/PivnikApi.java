package ru.pivnik.evotor;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
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

    /**
     * Setup-screen diagnostics: the same request as a scan, but the answer is a short text with the
     * real reason (HTTP status or the exception), so a till that cannot reach the server can be debugged.
     */
    static String diagnose(BridgeSettings settings) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(settings.apiBaseUrl() + "/api/device/pos/qr/resolve");
            connection = (HttpURLConnection) url.openConnection();
            PivnikTls.apply(connection);
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            // Works before a key is entered too: then a 401 already proves the server is reachable.
            String token = settings.deviceToken();
            if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Device " + token);
            byte[] body = "{\"payload\":\"PIVNIK-CONNECTION-CHECK\"}".getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            if (status == 404) return "OK";
            if (status == 401 && token.isEmpty()) return "NOKEY";
            if (status == 401 || status == 403 || status == 428) return "KEY";
            // Unexpected answer: say who answered (Railway or something on the till's network).
            StringBuilder details = new StringBuilder("HTTP " + status);
            appendHeader(details, connection, "Server");
            appendHeader(details, connection, "Via");
            appendHeader(details, connection, "Allow");
            appendHeader(details, connection, "X-Railway-Request-Id");
            appendHeader(details, connection, "X-Railway-Edge");
            if (connection instanceof HttpsURLConnection) {
                try {
                    java.security.cert.Certificate[] certs = ((HttpsURLConnection) connection).getServerCertificates();
                    if (certs.length > 0 && certs[0] instanceof X509Certificate) {
                        details.append("\nСертификат: ").append(((X509Certificate) certs[0]).getIssuerX500Principal().getName());
                    }
                } catch (Exception ignored) {}
            }
            try { details.append("\nIP: ").append(InetAddress.getByName(url.getHost()).getHostAddress()); }
            catch (Exception ignored) {}
            try {
                String text = read(connection.getErrorStream());
                if (text != null && !text.trim().isEmpty()) {
                    text = text.replaceAll("\\s+", " ").trim();
                    details.append("\nОтвет: ").append(text.length() > 160 ? text.substring(0, 160) : text);
                }
            } catch (Exception ignored) {}
            details.append("\nПроверка /api/health: ").append(health(settings));
            return details.toString();
        } catch (Exception error) {
            String message = error.getMessage();
            if (message != null && message.length() > 160) message = message.substring(0, 160);
            return "ERR " + error.getClass().getSimpleName() + (message == null ? "" : ": " + message);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void appendHeader(StringBuilder out, HttpURLConnection connection, String name) {
        String value = connection.getHeaderField(name);
        if (value != null) out.append("\n").append(name).append(": ").append(value.length() > 80 ? value.substring(0, 80) : value);
    }

    private static String health(BridgeSettings settings) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(settings.apiBaseUrl() + "/api/health").openConnection();
            PivnikTls.apply(connection);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(false);
            return "HTTP " + connection.getResponseCode();
        } catch (Exception error) {
            return error.getClass().getSimpleName();
        } finally {
            if (connection != null) connection.disconnect();
        }
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
            PivnikTls.apply(connection);
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
