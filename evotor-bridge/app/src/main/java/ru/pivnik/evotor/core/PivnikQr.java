package ru.pivnik.evotor.core;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Recognises only the two unambiguous PIVNIK customer code forms produced by the backend:
 * the QR image payload {@code PIVNIK:<qr_token>} (server.js, POST /api/me/qr) and the printed
 * short code {@code PVK-XXXX-XXXX}. The server-side normaliser also accepts a bare token, but a
 * bare {@code [A-Za-z0-9_-]{8,128}} string also matches every EAN-13 / product QR, so the till
 * must never claim such codes. The server stays the only authority on whether a code is valid.
 */
public final class PivnikQr {
    private static final Pattern INVISIBLE = Pattern.compile("[\\u200B-\\u200D\\uFEFF]");
    private static final Pattern TOKEN_PAYLOAD = Pattern.compile("(?i)^PIVNIK:([A-Za-z0-9_-]{8,128})$");
    private static final Pattern SHORT_CODE = Pattern.compile("^PVK-[A-Z0-9]{4}-[A-Z0-9]{4}$");

    private PivnikQr() {}

    /** Returns the payload to send to the PIVNIK resolver, or {@code null} for any non-PIVNIK code. */
    public static String detect(String barcode) {
        if (barcode == null) return null;
        String value = INVISIBLE.matcher(barcode).replaceAll("").trim();
        java.util.regex.Matcher token = TOKEN_PAYLOAD.matcher(value);
        if (token.matches()) return "PIVNIK:" + token.group(1);
        String upper = value.toUpperCase(Locale.ROOT);
        if (SHORT_CODE.matcher(upper).matches()) return upper;
        return null;
    }
}
