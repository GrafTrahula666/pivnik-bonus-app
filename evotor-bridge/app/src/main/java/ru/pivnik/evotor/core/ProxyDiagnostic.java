package ru.pivnik.evotor.core;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Error 2003 is a family of proxy failures, not evidence that proxying is disabled. */
public final class ProxyDiagnostic {
    private ProxyDiagnostic() {}

    public static String hint(String body) {
        if (body == null) return "";
        try {
            JSONArray errors = new JSONObject(body).optJSONArray("errors");
            if (errors == null) return "";
            boolean gatewayError = false;
            boolean notApplied = false;
            for (int i = 0; i < errors.length(); i++) {
                JSONObject error = errors.optJSONObject(i);
                if (error == null || error.optInt("code", -1) != 2003) continue;
                gatewayError = true;
                String reason = error.optString("reason", "");
                if ("Destination host unreachable".equalsIgnoreCase(reason)) {
                    return "Шлюз Эвотора не получил ответ сервера. Нужна проверка маршрута Эвотор → сервер "
                            + "по времени попытки и полям reason/subject. Эта ошибка не доказывает, что проксирование выключено.";
                }
                notApplied |= "The application is not applied to this device".equalsIgnoreCase(reason);
            }
            if (notApplied) return "Эвотор сообщает, что приложение не применено к этой кассе. "
                    + "Проверьте активацию приложения для кассы и список разрешённых URL в кабинете Эвотора.";
            return gatewayError ? "Ошибка шлюза Эвотора. Передайте поддержке время попытки и поля reason/subject." : "";
        } catch (JSONException error) {
            return "";
        }
    }
}
