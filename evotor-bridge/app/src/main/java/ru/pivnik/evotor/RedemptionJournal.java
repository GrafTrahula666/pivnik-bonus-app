package ru.pivnik.evotor;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;
import ru.pivnik.evotor.core.RedemptionOperation;

/** One durable file: operation plus monotonic receipt lifecycle, no QR or key. */
final class RedemptionJournal {
    private static final Object LOCK=new Object();
    private static final String LIFE="lifecycle:", END="terminal:", OFFSET="recoveryOffset";
    private final SharedPreferences prefs;
    RedemptionJournal(Context context) { prefs=context.getApplicationContext().getSharedPreferences("pivnik_redemptions_v1",Context.MODE_PRIVATE); }
    RedemptionOperation get(String receipt) {
        synchronized(LOCK) {
            String raw=prefs.getString(receipt,null);
            if (raw==null) return null;
            try { return RedemptionOperation.fromJson(new JSONObject(raw)); }
            catch (JSONException | IllegalArgumentException error) { throw new IllegalStateException("Не удалось прочитать сохранённое списание. Обратитесь к разработчику."); }
        }
    }
    void save(RedemptionOperation operation) {
        synchronized(LOCK) {
            if (isFinished(operation.receiptUuid) || prefs.getBoolean(END+operation.operationId,false)) throw new IllegalStateException("Чек уже завершён или удалён. Проверяем сохранённое списание.");
            RedemptionOperation previous=get(operation.receiptUuid);
            if (previous!=null && !previous.operationId.equals(operation.operationId)) throw new IllegalStateException("В чеке уже есть другое списание.");
            try {
                if (!prefs.edit().putString(operation.receiptUuid,operation.toJson().toString()).commit()) throw new IllegalStateException("Не удалось сохранить списание.");
            } catch (JSONException error) { throw new IllegalStateException("Не удалось сохранить списание."); }
        }
    }
    void deleted(String receipt) {
        synchronized(LOCK) {
            if (get(receipt)==null || "completed".equals(lifecycle(receipt))) return;
            if (!prefs.edit().putString(LIFE+receipt,"deleted").commit()) throw new IllegalStateException("Не удалось сохранить удаление чека.");
        }
    }
    void completed(String receipt) {
        synchronized(LOCK) {
            if (get(receipt)==null) return;
            if (!prefs.edit().putString(LIFE+receipt,"completed").commit()) throw new IllegalStateException("Не удалось сохранить закрытие чека.");
        }
    }
    String lifecycle(String receipt) { synchronized(LOCK) { return prefs.getString(LIFE+receipt,null); } }
    boolean isFinished(String receipt) { return lifecycle(receipt)!=null; }
    List<RedemptionOperation> operations() {
        synchronized(LOCK) {
            List<RedemptionOperation> result=new ArrayList<>();
            for (String key:prefs.getAll().keySet()) if (!key.equals(OFFSET) && key.matches("[A-Za-z0-9-]{1,200}")) {
                RedemptionOperation op=get(key); if (op!=null) result.add(op);
            }
            return result;
        }
    }
    int nextRecoveryOffset(int size,int batch) {
        synchronized(LOCK) {
            int start=(prefs.getInt(OFFSET,0)%size+size)%size;
            if (!prefs.edit().putInt(OFFSET,(start+batch)%size).commit()) throw new IllegalStateException("Не удалось сохранить проверку списаний.");
            return start;
        }
    }
    boolean clear(String receipt,String expectedOperation) {
        synchronized(LOCK) {
            RedemptionOperation current=get(receipt);
            if (current==null || !current.operationId.equals(expectedOperation)) return false;
            if (!prefs.edit().remove(receipt).putBoolean(END+expectedOperation,true).commit()) throw new IllegalStateException("Не удалось сохранить подтверждение отмены.");
            return true;
        }
    }
}
