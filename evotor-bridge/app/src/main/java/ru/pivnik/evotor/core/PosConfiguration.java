package ru.pivnik.evotor.core;

import java.net.URI;

public final class PosConfiguration {
    private PosConfiguration() {}

    public static boolean validToken(String token) {
        return token != null && token.matches("pvpos_[A-Za-z0-9_-]{43}");
    }

    public static boolean validBase(String base) {
        try {
            URI uri = new URI(base);
            return "https".equals(uri.getScheme()) && uri.getHost() != null
                    && uri.getUserInfo() == null && uri.getQuery() == null && uri.getFragment() == null;
        } catch (Exception error) { return false; }
    }
}
