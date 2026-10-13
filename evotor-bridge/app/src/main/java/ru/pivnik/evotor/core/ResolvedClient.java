package ru.pivnik.evotor.core;

import java.util.regex.Pattern;

/** A customer the PIVNIK backend confirmed for a scanned code. Never built from QR contents. */
public final class ResolvedClient {
    private static final Pattern USER_ID = Pattern.compile("^[0-9]{1,19}$");

    public final String userId;
    public final String displayName;

    public ResolvedClient(String userId, String displayName) {
        if (userId == null || !USER_ID.matcher(userId).matches()) {
            throw new IllegalArgumentException("PIVNIK user id must be a server-issued numeric id");
        }
        this.userId = userId;
        String name = displayName == null ? "" : displayName.trim();
        this.displayName = name.isEmpty() ? "клиент" : (name.length() > 40 ? name.substring(0, 40) : name);
    }
}
