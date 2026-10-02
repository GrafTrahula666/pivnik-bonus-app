package ru.pivnik.kiosk.shift;

import org.json.JSONObject;

import java.io.IOException;
import java.util.List;

/** Backend contract (kiosk-shifts/http.js). IOException = network problem, always retryable. */
public interface ShiftApi {
    JSONObject enroll(String code, String label) throws IOException, ApiException;
    JSONObject startShift(JSONObject body) throws IOException, ApiException;
    void uploadPhoto(String shiftId, String kind, String photoId, byte[] jpeg) throws IOException, ApiException;
    JSONObject submit(String shiftId, String kind, List<String> photoIds) throws IOException, ApiException;
    /** Same, plus the values the employee typed (report only). Servers without the AI check use them. */
    default JSONObject submit(String shiftId, String kind, List<String> photoIds, JSONObject manual) throws IOException, ApiException {
        return submit(shiftId, kind, photoIds);
    }
    JSONObject close(String shiftId, long closedAt) throws IOException, ApiException;

    final class ApiException extends Exception {
        public final int status;
        public final String code;
        public final boolean retryable;

        public ApiException(int status, String message, String code, boolean retryable) {
            super(message);
            this.status = status;
            this.code = code == null ? "" : code;
            this.retryable = retryable;
        }
    }
}
