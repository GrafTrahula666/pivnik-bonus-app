package ru.pivnik.evotor.core;

/** Persists the single active binding and a pending "replace customer" request across process restarts. */
public interface BindingStore {
    ReceiptBinding loadBinding();

    void saveBinding(ReceiptBinding binding);

    void clearBinding();

    ReceiptBinding loadPendingReplacement();

    void savePendingReplacement(ReceiptBinding pending);

    void clearPendingReplacement();
}
