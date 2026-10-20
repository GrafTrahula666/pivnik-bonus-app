package ru.pivnik.evotor.core;

import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class ForegroundScanTest {
    private static final String QR = "PIVNIK:FixtureGuest_12345";
    private static final class Fixture {
        final List<String> requests = new ArrayList<>();
        final List<String> messages = new ArrayList<>();
        final List<ForegroundScan.Completion> completions = new ArrayList<>();
        final ForegroundScan scan = new ForegroundScan((payload, done) -> {
            requests.add(payload);
            completions.add(done);
        }, messages::add);
        String last() { return messages.get(messages.size() - 1); }
    }

    @Test public void productCodesAndPausedScreensNeverReachTheServer() {
        Fixture f = new Fixture();
        f.scan.barcode(QR);
        assertTrue(f.requests.isEmpty());
        f.scan.resume();
        f.scan.barcode("4601234567890");
        assertTrue(f.requests.isEmpty());
        assertTrue(f.last().contains("не QR клиента"));
        f.scan.pause();
        f.scan.barcode(QR);
        assertTrue(f.requests.isEmpty());
    }

    @Test public void oneScanAtATimeAndConfirmationOnlyAfterTheBindCompletes() {
        Fixture f = new Fixture();
        f.scan.resume();
        f.scan.barcode("  pivnik:FixtureGuest_12345\n");
        f.scan.barcode(QR);
        assertEquals(1, f.requests.size());
        assertEquals(QR, f.requests.get(0));
        assertTrue(f.last().contains("Проверяем"));
        f.completions.get(0).complete("PIVNIK ✓ Гость");
        assertEquals("PIVNIK ✓ Гость", f.last());
        f.scan.barcode(QR);
        assertEquals(2, f.requests.size());
    }

    @Test public void returningToTheWindowDoesNotShowAPreviousReceiptsClient() {
        Fixture f = new Fixture();
        f.scan.resume();
        f.scan.barcode(QR);
        f.scan.pause();
        int count = f.messages.size();
        f.completions.get(0).complete("PIVNIK ✓ Старый клиент");
        assertEquals(count, f.messages.size());
        f.scan.resume();
        assertFalse(f.last().contains("Старый клиент"));
        f.scan.barcode(QR);
        assertEquals(2, f.requests.size());
    }

    @Test public void resumeDuringAnOldRequestDoesNotQueueANewScanOrShowItsStaleResult() {
        Fixture f = new Fixture();
        f.scan.resume();
        f.scan.barcode(QR);
        f.scan.pause();
        f.scan.resume();
        f.scan.barcode("PVK-AAAA-2222");
        assertEquals(1, f.requests.size());
        f.completions.get(0).complete("PIVNIK ✓ Старый клиент");
        assertFalse(f.last().contains("Старый клиент"));
        f.scan.barcode("PVK-AAAA-2222");
        assertEquals(2, f.requests.size());
    }

    @Test public void duplicateCompletionCannotReleaseANewerPendingRequest() {
        Fixture f = new Fixture();
        f.scan.resume();
        f.scan.barcode(QR);
        f.completions.get(0).complete("Ошибка связи");
        f.scan.barcode(QR);
        f.completions.get(0).complete("Поздний повтор");
        f.scan.barcode(QR);
        assertEquals(2, f.requests.size());
        assertFalse(f.last().contains("Поздний повтор"));
    }
}
