package ru.pivnik.evotor.core;

import java.util.regex.Pattern;

/** A customer the PIVNIK backend confirmed for a scanned code. Never built from QR contents. */
public final class ResolvedClient {
    private static final Pattern USER_ID = Pattern.compile("^[0-9]{1,19}$");

    public final String userId;
    public final String displayName;
    /** Null means unavailable/old server, never zero. A snapshot, not a spending authorization. */
    public final Long bonusBalance;
    public final boolean unlimitedBonus;

    public ResolvedClient(String userId, String displayName) {
        this(userId, displayName, null, false);
    }

    public ResolvedClient(String userId, String displayName, Long bonusBalance, boolean unlimitedBonus) {
        if (userId == null || !USER_ID.matcher(userId).matches()) {
            throw new IllegalArgumentException("PIVNIK user id must be a server-issued numeric id");
        }
        this.userId = userId;
        String name = displayName == null ? "" : displayName.trim();
        this.displayName = name.isEmpty() ? "клиент" : (name.length() > 40 ? name.substring(0, 40) : name);
        if (bonusBalance != null && (bonusBalance < 0 || bonusBalance > 9007199254740991L)) {
            throw new IllegalArgumentException("Invalid balance");
        }
        if (unlimitedBonus && bonusBalance == null) throw new IllegalArgumentException("Unlimited balance missing");
        this.bonusBalance = bonusBalance;
        this.unlimitedBonus = unlimitedBonus;
    }
}
