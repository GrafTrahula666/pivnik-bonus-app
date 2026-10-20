package ru.pivnik.evotor;

import android.content.Context;
import android.content.SharedPreferences;
import ru.pivnik.evotor.core.BindingStore;
import ru.pivnik.evotor.core.ReceiptBinding;

/** Keeps the binding across a crash/restart of the bridge process; commit() so it is on disk at once. */
final class PrefsBindingStore implements BindingStore {
    private static final String PREFS = "pivnik_evotor_binding";
    private static final String ACTIVE = "active_";
    private static final String PENDING = "pending_";

    private final SharedPreferences prefs;

    PrefsBindingStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Override public ReceiptBinding loadBinding() { return load(ACTIVE); }
    @Override public void saveBinding(ReceiptBinding binding) { save(ACTIVE, binding); }
    @Override public void clearBinding() { clear(ACTIVE); }
    @Override public ReceiptBinding loadPendingReplacement() { return load(PENDING); }
    @Override public void savePendingReplacement(ReceiptBinding pending) { save(PENDING, pending); }
    @Override public void clearPendingReplacement() { clear(PENDING); }

    private ReceiptBinding load(String prefix) {
        String receipt = prefs.getString(prefix + "receipt", null);
        String user = prefs.getString(prefix + "user", null);
        if (receipt == null || user == null) return null;
        try {
            String rawBalance = prefs.getString(prefix + "balance", null);
            Long balance = rawBalance == null ? null : Long.valueOf(rawBalance);
            return new ReceiptBinding(receipt, user, prefs.getString(prefix + "name", ""), prefs.getLong(prefix + "at", 0),
                    balance, prefs.getBoolean(prefix + "unlimited", false));
        } catch (IllegalArgumentException | ClassCastException corrupt) {
            clear(prefix);
            return null;
        }
    }

    private void save(String prefix, ReceiptBinding binding) {
        prefs.edit()
                .putString(prefix + "receipt", binding.receiptUuid)
                .putString(prefix + "user", binding.userId)
                .putString(prefix + "name", binding.displayName)
                .putLong(prefix + "at", binding.boundAtMillis)
                .putString(prefix + "balance", binding.bonusBalance == null ? null : binding.bonusBalance.toString())
                .putBoolean(prefix + "unlimited", binding.unlimitedBonus)
                .commit();
    }

    private void clear(String prefix) {
        prefs.edit()
                .remove(prefix + "receipt")
                .remove(prefix + "user")
                .remove(prefix + "name")
                .remove(prefix + "at")
                .remove(prefix + "balance")
                .remove(prefix + "unlimited")
                .commit();
    }
}
