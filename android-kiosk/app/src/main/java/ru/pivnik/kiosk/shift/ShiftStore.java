package ru.pivnik.kiosk.shift;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Durable local state: the current shift and shifts that were left unclosed.
 * Writes are synchronous so an app kill or reboot right after an action
 * cannot lose the shift.
 */
public final class ShiftStore {
    /** Synchronous string storage (SharedPreferences.commit on the phone). */
    public interface KeyValue {
        String get(String key);
        void put(String key, String value);
    }

    static final String CURRENT = "current_shift";
    static final String ARCHIVE = "unclosed_archive";
    private static final int ARCHIVE_LIMIT = 10;

    private final KeyValue storage;

    public ShiftStore(KeyValue storage) { this.storage = storage; }

    public synchronized Shift current() {
        String raw = storage.get(CURRENT);
        if (raw == null || raw.isEmpty()) return null;
        try {
            return Shift.fromJson(new JSONObject(raw));
        } catch (Exception e) {
            return null;
        }
    }

    public synchronized void save(Shift shift) {
        try {
            storage.put(CURRENT, shift == null ? "" : shift.toJson().toString());
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось сохранить смену", e);
        }
    }

    /** Keeps a replaced (never closed) shift instead of deleting it. */
    public synchronized void archiveUnclosed(Shift shift) {
        try {
            JSONArray archive = archive();
            shift.status = Shift.STATUS_LEFT_UNCLOSED;
            archive.put(shift.toJson());
            while (archive.length() > ARCHIVE_LIMIT) archive.remove(0);
            storage.put(ARCHIVE, archive.toString());
        } catch (Exception e) {
            throw new IllegalStateException("Не удалось сохранить предыдущую смену", e);
        }
    }

    public synchronized JSONArray archive() {
        String raw = storage.get(ARCHIVE);
        try {
            return raw == null || raw.isEmpty() ? new JSONArray() : new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }
}
