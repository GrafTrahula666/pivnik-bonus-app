package ru.pivnik.evotor.core;

/**
 * Decides which verified PIVNIK customer, if any, belongs to which open Evotor receipt.
 *
 * <p>Invariants: a binding is keyed by receipt UUID and is only ever returned for that exact UUID;
 * it is dropped when that receipt closes or is deleted, or when another receipt is opened; it
 * expires after {@link #TTL_MS}. A different customer never silently replaces the bound one: the
 * same new code has to be scanned twice within {@link #REPLACE_CONFIRM_WINDOW_MS}.
 */
public final class BindingPolicy {
    public static final long TTL_MS = 3L * 60 * 60 * 1000;
    public static final long REPLACE_CONFIRM_WINDOW_MS = 20_000;

    public enum Outcome {
        /** Customer attached to the open receipt. */
        BOUND,
        /** The same customer was already attached; nothing changed. */
        ALREADY_BOUND,
        /** Another customer is attached; scan the new code again to replace. */
        REPLACE_NEEDS_CONFIRMATION,
        /** The previous customer was replaced after a confirming second scan. */
        REPLACED,
        /** The receipt changed (or closed) while the code was being checked; nothing attached. */
        RECEIPT_CHANGED
    }

    private final BindingStore store;

    public BindingPolicy(BindingStore store) {
        this.store = store;
    }

    /**
     * Applies a backend-confirmed customer to the receipt that was open when the code was scanned.
     *
     * @param scannedReceiptUuid receipt open at scan time
     * @param currentReceiptUuid receipt open now, after the backend answered (null if none)
     */
    public synchronized Outcome onCustomerResolved(String scannedReceiptUuid, String currentReceiptUuid,
                                                   ResolvedClient client, long nowMillis) {
        if (scannedReceiptUuid == null || !scannedReceiptUuid.equals(currentReceiptUuid)) {
            return Outcome.RECEIPT_CHANGED;
        }
        ReceiptBinding existing = activeBinding(currentReceiptUuid, nowMillis);
        ReceiptBinding candidate = new ReceiptBinding(currentReceiptUuid, client.userId, client.displayName, nowMillis);
        if (existing == null) {
            store.clearPendingReplacement();
            store.saveBinding(candidate);
            return Outcome.BOUND;
        }
        if (existing.userId.equals(client.userId)) {
            store.clearPendingReplacement();
            return Outcome.ALREADY_BOUND;
        }
        ReceiptBinding pending = store.loadPendingReplacement();
        boolean confirmed = pending != null
                && pending.receiptUuid.equals(currentReceiptUuid)
                && pending.userId.equals(client.userId)
                && nowMillis - pending.boundAtMillis >= 0
                && nowMillis - pending.boundAtMillis <= REPLACE_CONFIRM_WINDOW_MS;
        if (confirmed) {
            store.clearPendingReplacement();
            store.saveBinding(candidate);
            return Outcome.REPLACED;
        }
        store.savePendingReplacement(candidate);
        return Outcome.REPLACE_NEEDS_CONFIRMATION;
    }

    /** The customer bound to this receipt, or null. Never answers for another receipt. */
    public synchronized ReceiptBinding bindingFor(String receiptUuid, long nowMillis) {
        if (receiptUuid == null) return null;
        return activeBinding(receiptUuid, nowMillis);
    }

    /** The bound customer currently stored, regardless of receipt. */
    public synchronized ReceiptBinding storedBinding() {
        return store.loadBinding();
    }

    /** A receipt was closed or deleted: its binding must not leak into the next sale. */
    public synchronized void onReceiptFinished(String receiptUuid) {
        ReceiptBinding binding = store.loadBinding();
        if (binding != null && binding.receiptUuid.equals(receiptUuid)) store.clearBinding();
        ReceiptBinding pending = store.loadPendingReplacement();
        if (pending != null && pending.receiptUuid.equals(receiptUuid)) store.clearPendingReplacement();
    }

    /** A new receipt was opened: anything bound to a different receipt is stale. */
    public synchronized void onReceiptOpened(String receiptUuid) {
        ReceiptBinding binding = store.loadBinding();
        if (binding != null && !binding.receiptUuid.equals(receiptUuid)) store.clearBinding();
        ReceiptBinding pending = store.loadPendingReplacement();
        if (pending != null && !pending.receiptUuid.equals(receiptUuid)) store.clearPendingReplacement();
    }

    private ReceiptBinding activeBinding(String receiptUuid, long nowMillis) {
        ReceiptBinding binding = store.loadBinding();
        if (binding == null) return null;
        if (isExpired(binding, nowMillis)) {
            clearAll();
            return null;
        }
        return binding.receiptUuid.equals(receiptUuid) ? binding : null;
    }

    private static boolean isExpired(ReceiptBinding binding, long nowMillis) {
        long age = nowMillis - binding.boundAtMillis;
        return age < 0 || age > TTL_MS;
    }

    private void clearAll() {
        store.clearBinding();
        store.clearPendingReplacement();
    }
}
