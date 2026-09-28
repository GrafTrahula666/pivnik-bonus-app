package ru.pivnik.kiosk.shift;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class ShiftControllerTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();

    /** Survives "reboots": a new ShiftStore over the same map sees the same data. */
    private final Map<String, String> disk = new HashMap<>();
    private FakeApi api;
    private long now;

    private ShiftController controller() {
        ShiftStore store = new ShiftStore(new ShiftStore.KeyValue() {
            @Override public String get(String key) { return disk.getOrDefault(key, ""); }
            @Override public void put(String key, String value) { disk.put(key, value); }
        });
        return new ShiftController(store, api, () -> now);
    }

    @Before public void setUp() {
        api = new FakeApi();
        now = Instant.parse("2026-09-28T07:42:00Z").toEpochMilli(); // 10:42 Moscow
    }

    private String photo(String name) throws IOException {
        File file = folder.newFile(name + ".jpg");
        Files.write(file.toPath(), new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff, 1, 2, 3});
        return file.getAbsolutePath();
    }

    @Test public void openShiftIsSavedImmediatelyAndSurvivesRestart() {
        Shift opened = controller().openShift("  Анна ");
        assertEquals("Анна", opened.employeeName);
        assertFalse(opened.late);
        // New controller + store over the same storage = app restart / phone reboot.
        Shift restored = controller().current();
        assertNotNull(restored);
        assertEquals(opened.id, restored.id);
        assertEquals("Анна", restored.employeeName);
        assertEquals(opened.openedAt, restored.openedAt);
        assertEquals(Shift.STATUS_OPEN, restored.status);
    }

    @Test public void lateFlagSetAtExactly1100() {
        now = Instant.parse("2026-09-28T08:00:00Z").toEpochMilli();
        assertTrue(controller().openShift("Олег").late);
    }

    @Test(expected = IllegalArgumentException.class)
    public void emptyNameIsRejected() {
        controller().openShift("   ");
    }

    @Test public void startSyncRetriesAfterNetworkErrorWithTheSameShiftId() throws Exception {
        ShiftController c = controller();
        Shift shift = c.openShift("Анна");
        api.failStart = 1;
        try { c.syncStart(); fail(); } catch (IOException expected) {}
        Shift afterFailure = controller().current();
        assertFalse(afterFailure.serverConfirmed);
        assertEquals(ShiftController.NETWORK_ERROR, afterFailure.syncError);
        controller().syncStart();
        assertTrue(controller().current().serverConfirmed);
        assertEquals(2, api.startBodies.size());
        assertEquals(shift.id, api.startBodies.get(0).getString("shiftId"));
        assertEquals(shift.id, api.startBodies.get(1).getString("shiftId"));
        assertEquals("2026-09-28T07:42:00Z", api.startBodies.get(1).getString("openedAt"));
    }

    @Test public void uploadRetryKeepsPhotosAndSendsOnlyMissingOnes() throws Exception {
        ShiftController c = controller();
        c.openShift("Анна");
        c.addPhoto(Shift.KIND_REPORT, UUID.randomUUID().toString(), photo("a"), null);
        c.addPhoto(Shift.KIND_REPORT, UUID.randomUUID().toString(), photo("b"), null);
        api.failUploadAt = 2; // second photo upload hits a network error
        try { c.submit(Shift.KIND_REPORT); fail(); } catch (IOException expected) {}

        Shift saved = controller().current();
        assertEquals(Doc.ERROR, saved.report.status);
        assertEquals(2, saved.report.photos.size());
        assertTrue(saved.report.photos.get(0).uploaded);
        assertFalse(saved.report.photos.get(1).uploaded);
        assertTrue(new File(saved.report.photos.get(1).path).exists());
        assertFalse(ShiftRules.canClose(saved));

        api.failUploadAt = -1;
        Doc doc = controller().submit(Shift.KIND_REPORT);
        assertEquals(Doc.ACCEPTED, doc.status);
        assertEquals(3, api.uploads.size()); // a, (b failed), b
        assertEquals("5 000", controller().current().report.fields.getString("cash_open"));
    }

    @Test public void rejectedReportShowsConcreteProblemsAndKeepsCloseDisabled() throws Exception {
        ShiftController c = controller();
        c.openShift("Анна");
        c.addPhoto(Shift.KIND_REPORT, UUID.randomUUID().toString(), photo("r"), null);
        api.reportAccepted = false;
        Doc doc = c.submit(Shift.KIND_REPORT);
        assertEquals(Doc.REJECTED, doc.status);
        assertEquals("Поле «ИТОГО НАЛИЧНЫХ» пустое — заполните его и переснимите середину листа (итоги колонок).", doc.problems.get(0));
        assertFalse(ShiftRules.canClose(controller().current()));
    }

    @Test public void closeOnlyAfterBothDocumentsAccepted() throws Exception {
        ShiftController c = controller();
        c.openShift("Анна");
        try { c.close(); fail(); } catch (IllegalStateException expected) {
            assertEquals("Документы не сданы. Завершить смену невозможно.", expected.getMessage());
        }
        c.addPhoto(Shift.KIND_REPORT, UUID.randomUUID().toString(), photo("r1"), null);
        c.submit(Shift.KIND_REPORT);
        try { c.close(); fail(); } catch (IllegalStateException expected) {}
        for (int i = 0; i < 3; i++) c.addPhoto(Shift.KIND_RECEIPT, UUID.randomUUID().toString(), photo("c" + i), null);
        try { c.addPhoto(Shift.KIND_RECEIPT, UUID.randomUUID().toString(), photo("c4"), null); fail(); } catch (IllegalStateException expected) {}
        c.submit(Shift.KIND_RECEIPT);
        assertEquals(3, api.lastSubmitIds.size());
        assertTrue(ShiftRules.canClose(controller().current()));
        now += 12 * 3600_000L;
        c.close();
        assertNull(controller().current());
        assertEquals(1, api.closes);
    }

    @Test public void invoicesAreOptionalAndClearedAfterConfirmedSend() throws Exception {
        ShiftController c = controller();
        c.openShift("Анна");
        String path = photo("inv");
        c.addPhoto(Shift.KIND_INVOICE, UUID.randomUUID().toString(), path, null);
        Doc doc = c.submit(Shift.KIND_INVOICE);
        assertEquals(1, doc.sentCount);
        assertTrue(doc.photos.isEmpty());
        assertFalse(new File(path).exists());
        assertFalse(ShiftRules.canClose(controller().current()));
    }

    @Test public void retakeReplacesThePhotoInPlaceAndDeleteRemovesIt() throws Exception {
        ShiftController c = controller();
        c.openShift("Анна");
        String firstId = UUID.randomUUID().toString();
        String first = photo("first");
        c.addPhoto(Shift.KIND_REPORT, firstId, first, null);
        c.addPhoto(Shift.KIND_REPORT, UUID.randomUUID().toString(), photo("second"), null);
        String newId = UUID.randomUUID().toString();
        c.addPhoto(Shift.KIND_REPORT, newId, photo("retake"), firstId);
        Shift shift = controller().current();
        assertEquals(2, shift.report.photos.size());
        assertEquals(newId, shift.report.photos.get(0).id);
        assertFalse(new File(first).exists());
        c.removePhoto(Shift.KIND_REPORT, newId);
        assertEquals(1, controller().current().report.photos.size());
    }

    @Test public void serverMissingPhotosTriggersOneFullReupload() throws Exception {
        ShiftController c = controller();
        c.openShift("Анна");
        c.addPhoto(Shift.KIND_RECEIPT, UUID.randomUUID().toString(), photo("x"), null);
        api.photosMissingOnce = true;
        assertEquals(Doc.ACCEPTED, c.submit(Shift.KIND_RECEIPT).status);
        assertEquals(2, api.uploads.size());
    }

    @Test public void interruptedCheckIsRestoredAsRetryableNotAccepted() throws Exception {
        ShiftController c = controller();
        c.openShift("Анна");
        Shift shift = c.current();
        shift.report.status = Doc.CHECKING;
        disk.put(ShiftStore.CURRENT, shift.toJson().toString());
        assertEquals(Doc.ERROR, controller().current().report.status);
    }

    @Test public void startingOverAnUnclosedShiftArchivesItAndTellsTheServer() throws Exception {
        ShiftController c = controller();
        Shift old = c.openShift("Анна");
        now += 26 * 3600_000L;
        Shift next = c.openShift("Олег");
        assertEquals(old.id, next.previousUnclosed.getString("shiftId"));
        JSONArray archive = new ShiftStore(new ShiftStore.KeyValue() {
            @Override public String get(String key) { return disk.getOrDefault(key, ""); }
            @Override public void put(String key, String value) { disk.put(key, value); }
        }).archive();
        assertEquals(1, archive.length());
        assertEquals("Анна", archive.getJSONObject(0).getString("employeeName"));
        assertEquals(Shift.STATUS_LEFT_UNCLOSED, archive.getJSONObject(0).getString("status"));
        c.syncStart();
        assertEquals(old.id, api.startBodies.get(0).getJSONObject("previousUnclosed").getString("shiftId"));
    }

    static final class FakeApi implements ShiftApi {
        int failStart;
        int failUploadAt = -1;
        boolean reportAccepted = true;
        boolean photosMissingOnce;
        int closes;
        final List<JSONObject> startBodies = new ArrayList<>();
        final List<String> uploads = new ArrayList<>();
        List<String> lastSubmitIds = new ArrayList<>();

        private static JSONObject obj(Object... pairs) {
            try {
                JSONObject json = new JSONObject();
                for (int i = 0; i < pairs.length; i += 2) json.put((String) pairs[i], pairs[i + 1]);
                return json;
            } catch (org.json.JSONException e) { throw new IllegalStateException(e); }
        }

        @Override public JSONObject enroll(String code, String label) { return new JSONObject(); }

        @Override public JSONObject startShift(JSONObject body) throws IOException {
            startBodies.add(body);
            if (failStart-- > 0) throw new IOException("offline");
            return obj("created", true, "previousUnclosed", new JSONArray());
        }

        @Override public void uploadPhoto(String shiftId, String kind, String photoId, byte[] jpeg) throws IOException {
            uploads.add(photoId);
            if (uploads.size() == failUploadAt) throw new IOException("offline");
        }

        @Override public JSONObject submit(String shiftId, String kind, List<String> photoIds) throws ApiException {
            lastSubmitIds = new ArrayList<>(photoIds);
            if (photosMissingOnce) {
                photosMissingOnce = false;
                throw new ApiException(409, "Не все фото загружены", "photos_missing", true);
            }
            if (Shift.KIND_INVOICE.equals(kind)) return obj("accepted", true, "sent", photoIds.size());
            if (Shift.KIND_REPORT.equals(kind) && !reportAccepted) {
                return obj("accepted", false, "problems", new JSONArray().put(obj(
                        "code", "field_empty",
                        "message", "Поле «ИТОГО НАЛИЧНЫХ» пустое — заполните его и переснимите середину листа (итоги колонок).")));
            }
            if (Shift.KIND_REPORT.equals(kind)) return obj("accepted", true, "problems", new JSONArray(), "fields", obj("cash_open", "5 000"));
            return obj("accepted", true, "problems", new JSONArray());
        }

        @Override public JSONObject close(String shiftId, long closedAt) {
            closes++;
            return new JSONObject();
        }
    }
}