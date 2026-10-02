package ru.pivnik.kiosk.shift;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

import ru.pivnik.kiosk.Prefs;

/** HTTPS client for /api/kiosk/v1. No secrets are compiled in: the device token comes from enrollment. */
public final class HttpShiftApi implements ShiftApi {
    private static final String PREFIX = "/api/kiosk/v1";
    private final Context context;

    public HttpShiftApi(Context context) { this.context = context.getApplicationContext(); }

    @Override public JSONObject enroll(String code, String label) throws IOException, ApiException {
        try {
            JSONObject body = new JSONObject().put("code", code == null ? "" : code.trim()).put("label", label == null ? "" : label.trim());
            return json("POST", "/enroll", body, false, 15_000);
        } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
    }

    @Override public JSONObject startShift(JSONObject body) throws IOException, ApiException {
        return json("POST", "/shifts", body, true, 20_000);
    }

    @Override public void uploadPhoto(String shiftId, String kind, String photoId, byte[] jpeg) throws IOException, ApiException {
        HttpURLConnection connection = open("PUT", "/shifts/" + shiftId + "/documents/" + kind + "/photos/" + photoId, true, 60_000);
        connection.setRequestProperty("Content-Type", "image/jpeg");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(jpeg.length);
        try (OutputStream out = connection.getOutputStream()) { out.write(jpeg); }
        finish(connection);
    }

    @Override public JSONObject submit(String shiftId, String kind, List<String> photoIds) throws IOException, ApiException {
        return submit(shiftId, kind, photoIds, null);
    }

    @Override public JSONObject submit(String shiftId, String kind, List<String> photoIds, JSONObject manual) throws IOException, ApiException {
        try {
            JSONArray ids = new JSONArray();
            for (String id : photoIds) ids.put(id);
            JSONObject body = new JSONObject().put("photoIds", ids);
            if (manual != null && manual.length() > 0) body.put("manual", manual);
            // AI checks of up to 3 high-resolution photos can take a while.
            return json("POST", "/shifts/" + shiftId + "/documents/" + kind + "/submit", body, true, 180_000);
        } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
    }

    @Override public JSONObject close(String shiftId, long closedAt) throws IOException, ApiException {
        try {
            return json("POST", "/shifts/" + shiftId + "/close", new JSONObject().put("closedAt", ShiftController.iso(closedAt)), true, 20_000);
        } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
    }

    private HttpURLConnection open(String method, String path, boolean auth, int readTimeoutMs) throws IOException, ApiException {
        String base = Prefs.getShiftApiBaseUrl(context);
        if (base.isEmpty()) throw new ApiException(0, "Не задан HTTPS адрес сервера смен", "no_server", false);
        URL url = new URL(base + PREFIX + path);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new ApiException(0, "Смены работают только через HTTPS", "no_https", false);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(readTimeoutMs);
        connection.setRequestProperty("Accept", "application/json");
        if (auth) {
            String token = ShiftCredentialStore.load(context);
            if (token.isEmpty()) throw new ApiException(401, "Телефон не подключён к системе смен. Администратор: «Подключить смены».", "device_not_enrolled", false);
            connection.setRequestProperty("Authorization", "KioskShift " + token);
        }
        return connection;
    }

    private JSONObject json(String method, String path, JSONObject body, boolean auth, int readTimeoutMs) throws IOException, ApiException {
        HttpURLConnection connection = open(method, path, auth, readTimeoutMs);
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
        return finish(connection);
    }

    private JSONObject finish(HttpURLConnection connection) throws IOException, ApiException {
        try {
            int status = connection.getResponseCode();
            String text = readAll(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream());
            JSONObject json;
            try { json = text.isEmpty() ? new JSONObject() : new JSONObject(text); }
            catch (org.json.JSONException e) { json = new JSONObject(); }
            if (status >= 200 && status < 300) return json;
            boolean retryable = json.has("retryable") ? json.optBoolean("retryable") : status >= 500 || status == 429;
            throw new ApiException(status, json.optString("error", "Ошибка сервера " + status), json.optString("code", ""), retryable);
        } finally {
            connection.disconnect();
        }
    }

    private static String readAll(InputStream input) throws IOException {
        if (input == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }
}
