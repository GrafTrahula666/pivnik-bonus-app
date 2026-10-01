package ru.pivnik.kiosk.shift;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

/**
 * Sends shift events straight from the phone to the owners' Telegram chat; there is no Pivnik server.
 * The bot token and chat id are entered once in the admin panel and kept in the Keystore-encrypted
 * ShiftCredentialStore as "botToken|chatId". Documents are accepted without any checking.
 */
public final class TelegramShiftApi implements ShiftApi {
    private static final String PREFS = "pivnik_kiosk_shift_tg";
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("dd.MM HH:mm");
    private final Context context;

    public TelegramShiftApi(Context context) { this.context = context.getApplicationContext(); }

    /** code = "botToken chatId" (space separated). Returns the credential to store as deviceToken. */
    @Override public JSONObject enroll(String code, String label) throws IOException, ApiException {
        String[] parts = code == null ? new String[0] : code.trim().split("\\s+");
        if (parts.length != 2 || !parts[0].contains(":")) {
            throw new ApiException(0, "Введите через пробел: токен бота и chat id", "bad_credentials", false);
        }
        String credential = parts[0] + "|" + parts[1];
        sendMessage(credential, "Киоск подключён" + (label == null || label.trim().isEmpty() ? "" : ": " + label.trim()));
        try {
            return new JSONObject().put("deviceToken", credential);
        } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
    }

    @Override public JSONObject startShift(JSONObject body) throws IOException, ApiException {
        String shiftId = body.optString("shiftId");
        String name = body.optString("employeeName");
        long openedAt = Instant.parse(body.optString("openedAt")).toEpochMilli();
        prefs().edit().putString("name:" + shiftId, name).putLong("opened:" + shiftId, openedAt).commit();
        JSONObject previous = body.optJSONObject("previousUnclosed");
        sendMessage(credential(), startText(name, openedAt, ShiftRules.isLate(openedAt),
                previous == null ? null : previous.optString("employeeName", "имя неизвестно")));
        return new JSONObject();
    }

    @Override public void uploadPhoto(String shiftId, String kind, String photoId, byte[] jpeg) throws IOException, ApiException {
        sendPhoto(credential(), jpeg, caption(kind, prefs().getString("name:" + shiftId, "")));
    }

    @Override public JSONObject submit(String shiftId, String kind, List<String> photoIds) throws IOException, ApiException {
        try {
            return new JSONObject().put("accepted", true);
        } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
    }

    @Override public JSONObject close(String shiftId, long closedAt) throws IOException, ApiException {
        String name = prefs().getString("name:" + shiftId, "");
        long openedAt = prefs().getLong("opened:" + shiftId, closedAt);
        sendMessage(credential(), closeText(name, openedAt, closedAt));
        prefs().edit().remove("name:" + shiftId).remove("opened:" + shiftId).apply();
        return new JSONObject();
    }

    static String startText(String name, long openedAt, boolean late, String previousUnclosedName) {
        StringBuilder text = new StringBuilder("▶ Начал смену: ").append(name)
                .append("\nВремя: ").append(format(openedAt));
        if (late) text.append("\n⚠ ОПОЗДАНИЕ");
        if (previousUnclosedName != null) text.append("\n⚠ Предыдущая смена не была закрыта: ").append(previousUnclosedName);
        return text.toString();
    }

    static String closeText(String name, long openedAt, long closedAt) {
        Duration worked = Duration.ofMillis(Math.max(0, closedAt - openedAt));
        return "⏹ Завершил смену: " + name
                + "\nНачало: " + format(openedAt)
                + "\nКонец: " + format(closedAt)
                + "\nОтработано: " + worked.toHours() + " ч " + worked.toMinutes() % 60 + " мин";
    }

    static String caption(String kind, String name) {
        String title = Shift.KIND_REPORT.equals(kind) ? "Табель" : Shift.KIND_RECEIPT.equals(kind) ? "Чек закрытия" : "Накладная";
        return name.isEmpty() ? title : title + " — " + name;
    }

    private static String format(long epochMillis) {
        return TIME.format(ZonedDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), ShiftRules.BAR_ZONE));
    }

    private SharedPreferences prefs() { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private String credential() throws ApiException {
        String credential = ShiftCredentialStore.load(context);
        if (credential.isEmpty()) throw new ApiException(0, "Telegram не подключён. Администратор: «Подключить смены».", "not_connected", false);
        return credential;
    }

    private static void sendMessage(String credential, String text) throws IOException, ApiException {
        try {
            byte[] body = new JSONObject().put("chat_id", chatId(credential)).put("text", text).toString().getBytes(StandardCharsets.UTF_8);
            HttpURLConnection connection = open(credential, "sendMessage", "application/json; charset=utf-8", body.length);
            try (OutputStream out = connection.getOutputStream()) { out.write(body); }
            finish(connection);
        } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
    }

    private static void sendPhoto(String credential, byte[] jpeg, String caption) throws IOException, ApiException {
        String boundary = "pivnik" + UUID.randomUUID().toString().replace("-", "");
        ByteArrayOutputStream body = new ByteArrayOutputStream(jpeg.length + 1024);
        field(body, boundary, "chat_id", chatId(credential));
        field(body, boundary, "caption", caption);
        body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(jpeg);
        body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        byte[] bytes = body.toByteArray();
        HttpURLConnection connection = open(credential, "sendPhoto", "multipart/form-data; boundary=" + boundary, bytes.length);
        connection.setReadTimeout(60_000);
        try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
        finish(connection);
    }

    private static void field(ByteArrayOutputStream out, String boundary, String name, String value) throws IOException {
        out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n").getBytes(StandardCharsets.UTF_8));
    }

    private static String chatId(String credential) { return credential.substring(credential.indexOf('|') + 1); }

    private static HttpURLConnection open(String credential, String method, String contentType, int length) throws IOException {
        String token = credential.substring(0, credential.indexOf('|'));
        HttpURLConnection connection = (HttpURLConnection) new URL("https://api.telegram.org/bot" + token + "/" + method).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(20_000);
        connection.setRequestProperty("Content-Type", contentType);
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(length);
        return connection;
    }

    private static void finish(HttpURLConnection connection) throws IOException, ApiException {
        try {
            int status = connection.getResponseCode();
            if (status >= 200 && status < 300) return;
            String text = readAll(connection.getErrorStream());
            String description;
            try { description = new JSONObject(text).optString("description", "Ошибка Telegram " + status); }
            catch (org.json.JSONException e) { description = "Ошибка Telegram " + status; }
            throw new ApiException(status, description, "", status >= 500 || status == 429);
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
