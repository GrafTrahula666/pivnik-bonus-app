package ru.pivnik.kiosk;

import android.content.Context;
import android.net.Uri;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public final class DeviceAuthClient {
    private DeviceAuthClient() {}

    public static final class PairResult {
        public final String deviceToken;
        public final String label;
        PairResult(String deviceToken, String label) { this.deviceToken = deviceToken; this.label = label; }
    }

    public static final class BootstrapResult {
        public final String code;
        public final String expiresAt;
        BootstrapResult(String code, String expiresAt) { this.code = code; this.expiresAt = expiresAt; }
    }

    public static PairResult pair(Context context, String pairingCode, String label) throws Exception {
        JSONObject body = new JSONObject();
        body.put("code", pairingCode == null ? "" : pairingCode.trim());
        body.put("label", label == null ? "" : label.trim());
        JSONObject data = request(context, "/api/device/pair", "POST", body, "");
        String token = data.optString("deviceToken", "");
        if (!token.startsWith("pvkdev_")) throw new IllegalStateException("Сервер не вернул ключ устройства");
        String serverLabel = data.optJSONObject("device") != null ? data.optJSONObject("device").optString("label", label) : label;
        DeviceCredentialStore.save(context, token);
        return new PairResult(token, serverLabel);
    }

    public static BootstrapResult bootstrap(Context context) throws Exception {
        String token = DeviceCredentialStore.load(context);
        if (token.isEmpty()) throw new IllegalStateException("Устройство ещё не привязано");
        JSONObject data = request(context, "/api/device/bootstrap", "POST", new JSONObject(), "Device " + token);
        String code = data.optString("bootstrapCode", "");
        if (!code.startsWith("pvkboot_")) throw new IllegalStateException("Сервер не вернул одноразовый код");
        return new BootstrapResult(code, data.optString("expiresAt", ""));
    }

    public static String telegramUri(String baseUri, String bootstrapCode) {
        Uri uri = Uri.parse(baseUri == null ? "" : baseUri.trim());
        if (uri.getScheme() == null) return baseUri;
        Uri.Builder builder = uri.buildUpon().clearQuery();
        for (String name : uri.getQueryParameterNames()) {
            if ("startapp".equals(name)) continue;
            for (String value : uri.getQueryParameters(name)) builder.appendQueryParameter(name, value);
        }
        builder.appendQueryParameter("startapp", bootstrapCode);
        return builder.build().toString();
    }

    public static String vkUri(String baseUri, String bootstrapCode) {
        Uri uri = Uri.parse(baseUri == null ? "" : baseUri.trim());
        if (uri.getScheme() == null) return baseUri;
        return uri.buildUpon().fragment(bootstrapCode).build().toString();
    }

    private static JSONObject request(Context context, String path, String method, JSONObject body, String authorization) throws Exception {
        String base = Prefs.getApiBaseUrl(context);
        if (base.isEmpty()) throw new IllegalStateException("Не задан HTTPS адрес сервера Пивника");
        URL url = new URL(base + path);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IllegalStateException("Device Auth разрешён только через HTTPS");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(7000);
        connection.setReadTimeout(7000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (authorization != null && !authorization.isEmpty()) connection.setRequestProperty("Authorization", authorization);
        connection.setDoOutput(true);
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
        int status = connection.getResponseCode();
        String response = readAll(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream());
        JSONObject json = response.isEmpty() ? new JSONObject() : new JSONObject(response);
        if (status < 200 || status >= 300) {
            String error = json.optString("error", "HTTP " + status);
            throw new IllegalStateException(error);
        }
        return json;
    }

    private static String readAll(InputStream input) throws Exception {
        if (input == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }
}
