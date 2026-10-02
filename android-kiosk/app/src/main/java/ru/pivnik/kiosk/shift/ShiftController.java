package ru.pivnik.kiosk.shift;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Shift workflow on the phone. All methods are blocking and must run off the
 * UI thread. State is saved after every step so nothing is lost on errors,
 * restarts or reboots; a document counts as sent only after the server said so.
 */
public final class ShiftController {
    public interface Clock { long now(); }

    public static final String NETWORK_ERROR = "Нет связи с сервером. Фото сохранены — нажмите «Повторить».";

    private final ShiftStore store;
    private final ShiftApi api;
    private final Clock clock;

    public ShiftController(ShiftStore store, ShiftApi api, Clock clock) {
        this.store = store;
        this.api = api;
        this.clock = clock;
    }

    public synchronized Shift current() { return store.current(); }

    /** Opens a shift locally. An existing open shift is archived, never deleted. */
    public synchronized Shift openShift(String rawName) {
        String name = ShiftRules.normalizeName(rawName);
        long now = clock.now();
        Shift previous = store.current();
        Shift shift = new Shift(UUID.randomUUID().toString(), name, now, ShiftRules.isLate(now));
        if (previous != null && Shift.STATUS_OPEN.equals(previous.status)) {
            try {
                shift.previousUnclosed = new JSONObject()
                        .put("shiftId", previous.id)
                        .put("employeeName", previous.employeeName)
                        .put("openedAt", iso(previous.openedAt));
            } catch (Exception ignored) {}
            store.archiveUnclosed(previous);
        }
        store.save(shift);
        return shift;
    }

    /** Idempotent: the same shift id can be sent any number of times. */
    public synchronized Shift syncStart() throws IOException, ShiftApi.ApiException {
        Shift shift = store.current();
        if (shift == null || shift.serverConfirmed) return shift;
        try {
            JSONObject body = new JSONObject()
                    .put("shiftId", shift.id)
                    .put("employeeName", shift.employeeName)
                    .put("openedAt", iso(shift.openedAt));
            if (shift.previousUnclosed != null) body.put("previousUnclosed", shift.previousUnclosed);
            JSONObject result = api.startShift(body);
            shift.serverConfirmed = true;
            shift.syncError = "";
            JSONArray previous = result.optJSONArray("previousUnclosed");
            if (previous != null && shift.previousUnclosed == null) {
                for (int i = 0; i < previous.length(); i++) {
                    JSONObject item = previous.optJSONObject(i);
                    if (item != null) shift.unclosedWarnings.add(item.optString("employeeName", "имя неизвестно"));
                }
            }
        } catch (IOException e) {
            shift.syncError = NETWORK_ERROR;
            store.save(shift);
            throw e;
        } catch (ShiftApi.ApiException e) {
            shift.syncError = e.getMessage();
            store.save(shift);
            throw e;
        } catch (org.json.JSONException e) {
            throw new IllegalStateException(e);
        }
        store.save(shift);
        return shift;
    }

    public synchronized void clearWarnings() {
        Shift shift = store.current();
        if (shift == null || shift.unclosedWarnings.isEmpty()) return;
        shift.unclosedWarnings.clear();
        store.save(shift);
    }

    public synchronized Shift addPhoto(String kind, String photoId, String path, String replacesPhotoId) {
        Shift shift = requireOpen();
        Doc doc = shift.doc(kind);
        if (Doc.ACCEPTED.equals(doc.status) && !Shift.KIND_INVOICE.equals(kind)) throw new IllegalStateException("Документ уже принят");
        Photo photo = new Photo(photoId, path, false);
        Photo replaced = replacesPhotoId == null ? null : doc.find(replacesPhotoId);
        if (replaced != null) {
            doc.photos.set(doc.photos.indexOf(replaced), photo);
            deleteFile(replaced.path);
        } else {
            if (doc.photos.size() >= ShiftRules.maxPhotos(kind)) {
                deleteFile(path);
                throw new IllegalStateException("Не больше " + ShiftRules.maxPhotos(kind) + " фото");
            }
            doc.photos.add(photo);
        }
        if (!Doc.ACCEPTED.equals(doc.status)) doc.status = Doc.MISSING;
        doc.problems.clear();
        doc.error = "";
        store.save(shift);
        return shift;
    }

    public synchronized Shift removePhoto(String kind, String photoId) {
        Shift shift = requireOpen();
        Doc doc = shift.doc(kind);
        Photo photo = doc.find(photoId);
        if (photo != null) {
            doc.photos.remove(photo);
            deleteFile(photo.path);
            store.save(shift);
        }
        return shift;
    }

    /**
     * Uploads every not-yet-confirmed photo, then asks the server to check the set.
     * On any failure the photos stay on the phone and the call can be repeated.
     */
    public synchronized Doc submit(String kind) throws IOException, ShiftApi.ApiException {
        Shift shift = requireOpen();
        Doc doc = shift.doc(kind);
        if (doc.photos.isEmpty()) throw new IllegalStateException("Сначала сделайте фото");
        if (Doc.ACCEPTED.equals(doc.status) && !Shift.KIND_INVOICE.equals(kind)) return doc;
        doc.status = Doc.CHECKING;
        doc.error = "";
        doc.problems.clear();
        store.save(shift);
        try {
            if (!shift.serverConfirmed) syncStart();
            shift = store.current();
            doc = shift.doc(kind);
            JSONObject result;
            try {
                result = uploadAndSubmit(shift, doc);
            } catch (ShiftApi.ApiException e) {
                if (!"photos_missing".equals(e.code)) throw e;
                for (Photo photo : doc.photos) photo.uploaded = false;
                store.save(shift);
                result = uploadAndSubmit(shift, doc);
            }
            applyResult(doc, result);
        } catch (IOException e) {
            markError(kind, NETWORK_ERROR, true);
            throw e;
        } catch (ShiftApi.ApiException e) {
            markError(kind, e.getMessage(), e.retryable);
            throw e;
        }
        store.save(shift);
        return doc;
    }

    /** Remembers what the employee typed on the report screen so it survives redraws and restarts. */
    public synchronized void setManual(String revenue, String cash) {
        Shift shift = store.current();
        if (shift == null) return;
        shift.report.manualRevenue = revenue == null ? "" : revenue.trim();
        shift.report.manualCash = cash == null ? "" : cash.trim();
        store.save(shift);
    }

    private void markError(String kind, String message, boolean retryable) {
        Shift latest = store.current();
        if (latest == null) return;
        Doc doc = latest.doc(kind);
        doc.status = Doc.ERROR;
        doc.error = message;
        doc.errorRetryable = retryable;
        store.save(latest);
    }

    private JSONObject uploadAndSubmit(Shift shift, Doc doc) throws IOException, ShiftApi.ApiException {
        List<String> ids = new ArrayList<>();
        for (Photo photo : doc.photos) {
            if (!photo.uploaded) {
                api.uploadPhoto(shift.id, doc.kind, photo.id, Files.readAllBytes(new File(photo.path).toPath()));
                photo.uploaded = true;
                store.save(shift);
            }
            ids.add(photo.id);
        }
        try {
            return api.submit(shift.id, doc.kind, ids, doc.manualJson());
        } catch (org.json.JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    private void applyResult(Doc doc, JSONObject result) {
        boolean accepted = result.optBoolean("accepted");
        doc.problems.clear();
        if (Shift.KIND_INVOICE.equals(doc.kind)) {
            if (accepted) {
                doc.sentCount += doc.photos.size();
                for (Photo photo : doc.photos) deleteFile(photo.path);
                doc.photos.clear();
                doc.status = Doc.MISSING;
            } else {
                doc.status = Doc.ERROR;
            }
            return;
        }
        doc.status = accepted ? Doc.ACCEPTED : Doc.REJECTED;
        JSONArray problems = result.optJSONArray("problems");
        if (problems != null) {
            for (int i = 0; i < problems.length(); i++) {
                JSONObject problem = problems.optJSONObject(i);
                String message = problem == null ? problems.optString(i) : problem.optString("message");
                if (message != null && !message.isEmpty()) doc.problems.add(message);
            }
        }
        if (!accepted && doc.problems.isEmpty()) doc.problems.add("Документ не принят — переснимите.");
        if (accepted && Shift.KIND_REPORT.equals(doc.kind)) doc.fields = result.optJSONObject("fields");
    }

    /** Only possible after both documents were accepted by the server. */
    public synchronized Shift close() throws IOException, ShiftApi.ApiException {
        Shift shift = requireOpen();
        if (!ShiftRules.canClose(shift)) throw new IllegalStateException("Документы не сданы. Завершить смену невозможно.");
        long closedAt = clock.now();
        api.close(shift.id, closedAt);
        shift.status = Shift.STATUS_CLOSED;
        shift.closedAt = closedAt;
        for (Doc doc : new Doc[]{shift.report, shift.receipt, shift.invoices}) {
            for (Photo photo : doc.photos) deleteFile(photo.path);
        }
        store.save(null);
        return shift;
    }

    private Shift requireOpen() {
        Shift shift = store.current();
        if (shift == null || !Shift.STATUS_OPEN.equals(shift.status)) throw new IllegalStateException("Смена не открыта");
        return shift;
    }

    private static void deleteFile(String path) {
        if (path == null || path.isEmpty()) return;
        //noinspection ResultOfMethodCallIgnored
        new File(path).delete();
    }

    static String iso(long epochMillis) {
        return java.time.Instant.ofEpochMilli(epochMillis).toString();
    }
}
