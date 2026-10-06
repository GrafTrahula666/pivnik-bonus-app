package ru.pivnik.evotor.core;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The receipt extra written through the Evotor SDK {@code SetExtra}. It carries only the
 * backend-confirmed PIVNIK user id: no name, phone, QR token or amounts. Amounts and items are
 * taken later from the closed fiscal document itself, never from the till or the customer.
 */
public final class PivnikExtra {
    public static final String KEY_USER_ID = "pivnik_user_id";
    public static final String KEY_VERSION = "pivnik_v";
    public static final int VERSION = 1;

    private static final Pattern STORED_USER_ID = Pattern.compile("\"" + KEY_USER_ID + "\"\\s*:\\s*\"([0-9]{1,19})\"");

    private PivnikExtra() {}

    public static JSONObject toJson(ReceiptBinding binding) {
        try {
            return new JSONObject()
                    .put(KEY_USER_ID, binding.userId)
                    .put(KEY_VERSION, VERSION);
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
    }

    /**
     * Whether a receipt's stored extra (Receipt.Header.extra) carries this user id. The stored
     * JSON may be nested or merged with other apps' data, so the key is matched anywhere.
     */
    public static boolean carriesUser(String storedExtra, String userId) {
        if (storedExtra == null || userId == null) return false;
        Matcher matcher = STORED_USER_ID.matcher(storedExtra);
        while (matcher.find()) {
            if (userId.equals(matcher.group(1))) return true;
        }
        return false;
    }
}
