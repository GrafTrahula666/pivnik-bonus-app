package ru.pivnik.kiosk.shift;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

/** Bar rules that must match the backend (kiosk-shifts/time.js). */
public final class ShiftRules {
    public static final ZoneId BAR_ZONE = ZoneId.of("Europe/Moscow");
    /** 11:00:00 exactly is already late. */
    public static final LocalTime LATE_FROM = LocalTime.of(11, 0);
    public static final int MAX_CHECK_PHOTOS = 3;
    public static final int MAX_INVOICE_PHOTOS = 10;
    public static final int MAX_NAME_LENGTH = 60;
    /** An open shift older than this may be replaced (with an owner notification). */
    public static final long STALE_AFTER_MILLIS = 14L * 60 * 60 * 1000;

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd.MM.yyyy");

    private ShiftRules() {}

    private static ZonedDateTime local(long epochMillis) {
        return Instant.ofEpochMilli(epochMillis).atZone(BAR_ZONE);
    }

    public static boolean isLate(long epochMillis) {
        return !local(epochMillis).toLocalTime().isBefore(LATE_FROM);
    }

    public static String localTime(long epochMillis) {
        return TIME.format(local(epochMillis));
    }

    public static String localDate(long epochMillis) {
        return DATE.format(local(epochMillis));
    }

    public static boolean sameBarDay(long a, long b) {
        return local(a).toLocalDate().equals(local(b).toLocalDate());
    }

    /** Free-text employee name; throws IllegalArgumentException with a user message. */
    public static String normalizeName(String raw) {
        String name = raw == null ? "" : raw.replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        if (name.isEmpty()) throw new IllegalArgumentException("Введите имя");
        if (name.length() > MAX_NAME_LENGTH) throw new IllegalArgumentException("Имя слишком длинное");
        boolean hasLetter = false;
        for (int i = 0; i < name.length(); i++) if (Character.isLetter(name.charAt(i))) { hasLetter = true; break; }
        if (!hasLetter) throw new IllegalArgumentException("Имя должно содержать буквы");
        return name;
    }

    public static int maxPhotos(String kind) {
        return Shift.KIND_INVOICE.equals(kind) ? MAX_INVOICE_PHOTOS : MAX_CHECK_PHOTOS;
    }

    public static boolean canClose(Shift shift) {
        return shift != null && Shift.STATUS_OPEN.equals(shift.status)
                && Doc.ACCEPTED.equals(shift.report.status)
                && Doc.ACCEPTED.equals(shift.receipt.status);
    }

    /** True when a new employee may start a new shift over this one. */
    public static boolean isStale(Shift shift, long now) {
        return shift != null && (!sameBarDay(shift.openedAt, now) || now - shift.openedAt >= STALE_AFTER_MILLIS);
    }

    /** Compact battery label, e.g. "🔋 84%". */
    public static String batteryLabel(int level, int scale, boolean charging) {
        if (level < 0 || scale <= 0) return "🔋 —";
        int percent = Math.max(0, Math.min(100, Math.round(level * 100f / scale)));
        return (charging ? "⚡ " : "🔋 ") + percent + "%";
    }
}
