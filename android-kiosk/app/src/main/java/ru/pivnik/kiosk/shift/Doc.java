package ru.pivnik.kiosk.shift;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** One document set of a shift: report (табель), receipt (чек) or invoices (накладные). */
public final class Doc {
    public static final String MISSING = "missing";
    public static final String CHECKING = "checking";
    public static final String REJECTED = "rejected";
    public static final String ACCEPTED = "accepted";
    public static final String ERROR = "error";

    public final String kind;
    public String status = MISSING;
    public final List<Photo> photos = new ArrayList<>();
    public final List<String> problems = new ArrayList<>();
    public String error = "";
    public boolean errorRetryable = true;
    /** Recognized report values exactly as written (report only). */
    public JSONObject fields = null;
    /** Report only: values typed by the employee (revenue, cash in the till). */
    public String manualRevenue = "";
    public String manualCash = "";
    /** Invoices only: photos already delivered. */
    public int sentCount = 0;

    public Doc(String kind) { this.kind = kind; }

    JSONObject toJson() throws JSONException {
        JSONArray photoArray = new JSONArray();
        for (Photo photo : photos) photoArray.put(photo.toJson());
        JSONArray problemArray = new JSONArray();
        for (String problem : problems) problemArray.put(problem);
        JSONObject json = new JSONObject()
                .put("kind", kind).put("status", status).put("photos", photoArray)
                .put("problems", problemArray).put("error", error)
                .put("errorRetryable", errorRetryable).put("sentCount", sentCount);
        if (fields != null) json.put("fields", fields);
        json.put("manualRevenue", manualRevenue).put("manualCash", manualCash);
        return json;
    }

    static Doc fromJson(String kind, JSONObject json) {
        Doc doc = new Doc(kind);
        if (json == null) return doc;
        doc.status = json.optString("status", MISSING);
        // A check interrupted by a restart is simply retried; never assume it passed.
        if (CHECKING.equals(doc.status)) doc.status = ERROR;
        JSONArray photoArray = json.optJSONArray("photos");
        if (photoArray != null) for (int i = 0; i < photoArray.length(); i++) doc.photos.add(Photo.fromJson(photoArray.optJSONObject(i)));
        JSONArray problemArray = json.optJSONArray("problems");
        if (problemArray != null) for (int i = 0; i < problemArray.length(); i++) doc.problems.add(problemArray.optString(i));
        doc.error = json.optString("error", "");
        doc.errorRetryable = json.optBoolean("errorRetryable", true);
        doc.fields = json.optJSONObject("fields");
        doc.sentCount = json.optInt("sentCount", 0);
        doc.manualRevenue = json.optString("manualRevenue", "");
        doc.manualCash = json.optString("manualCash", "");
        return doc;
    }

    /** Typed values for the server; null when nothing was entered. */
    JSONObject manualJson() throws JSONException {
        if (manualRevenue.isEmpty() && manualCash.isEmpty()) return null;
        return new JSONObject().put("revenue_total", manualRevenue).put("cash_close", manualCash);
    }

    public Photo find(String photoId) {
        for (Photo photo : photos) if (photo.id.equals(photoId)) return photo;
        return null;
    }
}
