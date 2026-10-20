package ru.pivnik.evotor;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONException;
import org.json.JSONObject;
import ru.pivnik.evotor.core.RedemptionOperation;

/** No QR/key here. Unresolved operations survive receipt switches and process death. */
final class RedemptionJournal {
    private final SharedPreferences prefs;
    RedemptionJournal(Context context) { prefs=context.getApplicationContext().getSharedPreferences("pivnik_redemptions_v1",Context.MODE_PRIVATE); }
    synchronized RedemptionOperation get(String receipt) {
        String raw=prefs.getString(receipt,null);
        if (raw==null) return null;
        try { return RedemptionOperation.fromJson(new JSONObject(raw)); }
        catch (JSONException | IllegalArgumentException error) { throw new IllegalStateException("Не удалось прочитать сохранённое списание. Обратитесь к разработчику."); }
    }
    synchronized void save(RedemptionOperation operation) {
        try {
            if (!prefs.edit().putString(operation.receiptUuid,operation.toJson().toString()).commit()) throw new IllegalStateException("Не удалось сохранить списание.");
        } catch (JSONException error) { throw new IllegalStateException("Не удалось сохранить списание."); }
    }
    synchronized void clear(String receipt) {
        if (!prefs.edit().remove(receipt).commit()) throw new IllegalStateException("Не удалось сохранить подтверждение отмены.");
    }
}
