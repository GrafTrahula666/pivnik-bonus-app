package ru.pivnik.kiosk.shift;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.time.Instant;

public class ShiftRulesTest {
    /** "10:59:00Z" read as Moscow wall-clock time on 2026-09-28 (UTC+3). */
    private static long moscow(String time) {
        return Instant.parse("2026-09-28T" + time).toEpochMilli() - 3 * 3600_000L;
    }

    @Test public void shiftStartedAt1059IsOnTime() {
        assertFalse(ShiftRules.isLate(moscow("10:59:00Z")));
        assertFalse(ShiftRules.isLate(moscow("10:59:59Z")));
    }

    @Test public void shiftStartedExactlyAt1100IsLate() {
        assertTrue(ShiftRules.isLate(moscow("11:00:00Z")));
    }

    @Test public void shiftStartedAt1101IsLate() {
        assertTrue(ShiftRules.isLate(moscow("11:01:00Z")));
        assertTrue(ShiftRules.isLate(moscow("23:30:00Z")));
    }

    @Test public void lateRuleUsesMoscowTimeNotDeviceZone() {
        // 08:00 UTC is 11:00 in Moscow.
        assertTrue(ShiftRules.isLate(Instant.parse("2026-09-28T08:00:00Z").toEpochMilli()));
        assertFalse(ShiftRules.isLate(Instant.parse("2026-09-28T07:59:59Z").toEpochMilli()));
        assertEquals("10:42", ShiftRules.localTime(moscow("10:42:30Z")));
        assertEquals("28.09.2026", ShiftRules.localDate(moscow("10:42:30Z")));
    }

    @Test public void nameIsFreeTextButValidated() {
        assertEquals("Анна Петрова", ShiftRules.normalizeName("  Анна \n Петрова "));
        for (String bad : new String[]{null, "", "   ", "12345", "---"}) {
            try { ShiftRules.normalizeName(bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) {}
        }
        try { ShiftRules.normalizeName(new String(new char[61]).replace('\0', 'а')); fail(); } catch (IllegalArgumentException expected) {}
    }

    @Test public void batteryLabelIsCompact() {
        assertEquals("🔋 84%", ShiftRules.batteryLabel(84, 100, false));
        assertEquals("⚡ 50%", ShiftRules.batteryLabel(1, 2, true));
        assertEquals("🔋 100%", ShiftRules.batteryLabel(255, 255, false));
        assertEquals("🔋 —", ShiftRules.batteryLabel(-1, 100, false));
    }

    @Test public void closeIsDisabledUntilBothDocumentsAccepted() {
        Shift shift = new Shift("id", "Анна", moscow("10:00:00Z"), false);
        assertFalse(ShiftRules.canClose(shift));
        shift.report.status = Doc.ACCEPTED;
        assertFalse(ShiftRules.canClose(shift));
        shift.invoices.status = Doc.ACCEPTED;
        assertFalse("invoices never unlock closing", ShiftRules.canClose(shift));
        shift.receipt.status = Doc.REJECTED;
        assertFalse(ShiftRules.canClose(shift));
        shift.receipt.status = Doc.ACCEPTED;
        assertTrue(ShiftRules.canClose(shift));
        shift.invoices.status = Doc.ERROR;
        assertTrue("invoices never block closing", ShiftRules.canClose(shift));
    }

    @Test public void staleShiftDetection() {
        Shift shift = new Shift("id", "Анна", moscow("10:00:00Z"), false);
        assertFalse(ShiftRules.isStale(shift, moscow("22:00:00Z")));
        assertTrue(ShiftRules.isStale(shift, moscow("10:00:00Z") + 24 * 3600_000L));
    }

    @Test public void photoLimits() {
        assertEquals(3, ShiftRules.maxPhotos(Shift.KIND_REPORT));
        assertEquals(3, ShiftRules.maxPhotos(Shift.KIND_RECEIPT));
        assertEquals(10, ShiftRules.maxPhotos(Shift.KIND_INVOICE));
    }
}
