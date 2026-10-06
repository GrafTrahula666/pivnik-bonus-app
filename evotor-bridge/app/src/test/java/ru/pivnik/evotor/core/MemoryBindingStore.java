package ru.pivnik.evotor.core;

final class MemoryBindingStore implements BindingStore {
    private ReceiptBinding binding;
    private ReceiptBinding pending;

    @Override public ReceiptBinding loadBinding() { return binding; }
    @Override public void saveBinding(ReceiptBinding value) { binding = value; }
    @Override public void clearBinding() { binding = null; }
    @Override public ReceiptBinding loadPendingReplacement() { return pending; }
    @Override public void savePendingReplacement(ReceiptBinding value) { pending = value; }
    @Override public void clearPendingReplacement() { pending = null; }
}
