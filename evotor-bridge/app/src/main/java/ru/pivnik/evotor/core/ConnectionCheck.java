package ru.pivnik.evotor.core;

import org.json.JSONException;
import org.json.JSONObject;

/** A proxy's arbitrary 401/404 must not be mistaken for a response from our POS API. */
public final class ConnectionCheck {
    private ConnectionCheck() {}

    public static String classify(boolean withKey, int status, String body) {
        if (body == null) return null;
        try {
            JSONObject answer = new JSONObject(body);
            String code = answer.optString("code", "");
            String error = answer.optString("error", "");
            boolean deviceRefused = "unauthorized_pos".equals(code)
                    || "Требуется ключ кассы.".equals(error)
                    || "Ключ кассы недействителен.".equals(error);
            if (status == 401 && deviceRefused) return withKey ? "KEY" : "NETWORK_OK";
            if (withKey && status == 404 && ("qr_not_found".equals(code)
                    || "QR не найден или отозван.".equals(error))) return "OK";
            return null;
        } catch (JSONException error) {
            return null;
        }
    }
}
