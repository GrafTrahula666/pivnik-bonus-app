package ru.pivnik.evotor.core;

/** One verified PIVNIK customer attached to exactly one Evotor receipt, identified by its UUID. */
public final class ReceiptBinding {
    public final String receiptUuid;
    public final String userId;
    public final String displayName;
    public final long boundAtMillis;
    public final Long bonusBalance;
    public final boolean unlimitedBonus;

    public ReceiptBinding(String receiptUuid, String userId, String displayName, long boundAtMillis) {
        this(receiptUuid, userId, displayName, boundAtMillis, null, false);
    }

    public ReceiptBinding(String receiptUuid, String userId, String displayName, long boundAtMillis,
                          Long bonusBalance, boolean unlimitedBonus) {
        if (receiptUuid == null || receiptUuid.isEmpty()) throw new IllegalArgumentException("receiptUuid is required");
        if (userId == null || userId.isEmpty()) throw new IllegalArgumentException("userId is required");
        this.receiptUuid = receiptUuid;
        this.userId = userId;
        this.displayName = displayName == null ? "" : displayName;
        this.boundAtMillis = boundAtMillis;
        if (bonusBalance != null && (bonusBalance < 0 || bonusBalance > 9007199254740991L)) {
            throw new IllegalArgumentException("Invalid balance");
        }
        if (unlimitedBonus && bonusBalance == null) throw new IllegalArgumentException("Missing balance");
        this.bonusBalance = bonusBalance;
        this.unlimitedBonus = unlimitedBonus;
    }
}
