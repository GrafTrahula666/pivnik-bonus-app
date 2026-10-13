package ru.pivnik.evotor.core;

/** One verified PIVNIK customer attached to exactly one Evotor receipt, identified by its UUID. */
public final class ReceiptBinding {
    public final String receiptUuid;
    public final String userId;
    public final String displayName;
    public final long boundAtMillis;

    public ReceiptBinding(String receiptUuid, String userId, String displayName, long boundAtMillis) {
        if (receiptUuid == null || receiptUuid.isEmpty()) throw new IllegalArgumentException("receiptUuid is required");
        if (userId == null || userId.isEmpty()) throw new IllegalArgumentException("userId is required");
        this.receiptUuid = receiptUuid;
        this.userId = userId;
        this.displayName = displayName == null ? "" : displayName;
        this.boundAtMillis = boundAtMillis;
    }
}
