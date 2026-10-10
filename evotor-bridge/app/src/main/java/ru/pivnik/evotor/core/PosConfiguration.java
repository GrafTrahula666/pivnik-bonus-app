package ru.pivnik.evotor.core;

import java.net.URI;

public final class PosConfiguration {
    private PosConfiguration() {}

    public static boolean validToken(String token) {
        return token != null && token.matches("pvpos_[A-Za-z0-9_-]{43}");
    }

    /** Typed or scanned key: drops spaces, line breaks (a scanner's Enter) and a copied "Device " prefix. */
    public static String cleanToken(String raw) {
        String value = raw == null ? "" : raw.replaceAll("\\s+", "");
        if (value.regionMatches(true, 0, "Device", 0, 6) && value.startsWith("pvpos_", 6)) value = value.substring(6);
        return value;
    }

    public static boolean validBase(String base) {
        try {
            URI uri = new URI(base);
            return "https".equals(uri.getScheme()) && uri.getHost() != null
                    && uri.getUserInfo() == null && uri.getQuery() == null && uri.getFragment() == null;
        } catch (Exception error) { return false; }
    }
}
