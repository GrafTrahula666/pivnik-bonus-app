package ru.pivnik.kiosk.shift;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Process-wide access to the shift controller and its single background worker. */
public final class ShiftService {
    private static final String PREFS = "pivnik_kiosk_shift_state";
    private static ShiftService instance;

    public final ShiftController controller;
    public final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final File photoDir;

    private ShiftService(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        ShiftStore store = new ShiftStore(new ShiftStore.KeyValue() {
            @Override public String get(String key) { return prefs.getString(key, ""); }
            // commit(): the shift must be on disk before we report success to the employee.
            @Override public void put(String key, String value) { prefs.edit().putString(key, value).commit(); }
        });
        controller = new ShiftController(store, new HttpShiftApi(app), System::currentTimeMillis);
        photoDir = new File(app.getFilesDir(), "shift_photos");
        //noinspection ResultOfMethodCallIgnored
        photoDir.mkdirs();
    }

    public static synchronized ShiftService get(Context context) {
        if (instance == null) instance = new ShiftService(context);
        return instance;
    }

    public File photoDir() { return photoDir; }
}
