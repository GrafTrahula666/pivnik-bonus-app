package ru.pivnik.kiosk.shift;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Locally persisted shift. The phone is the source of truth until the server confirms. */
public final class Shift {
    public static final String STATUS_OPEN = "open";
    public static final String STATUS_CLOSED = "closed";
    public static final String STATUS_LEFT_UNCLOSED = "left_unclosed";
    public static final String KIND_REPORT = "report";
    public static final String KIND_RECEIPT = "receipt";
    public static final String KIND_INVOICE = "invoice";

    public final String id;
    public final String employeeName;
    public final long openedAt;
    public final boolean late;
    public String status = STATUS_OPEN;
    /** The server has confirmed the shift start (and notified the owners). */
    public boolean serverConfirmed = false;
    public String syncError = "";
    public long closedAt = 0;
    public final Doc report = new Doc(KIND_REPORT);
    public final Doc receipt = new Doc(KIND_RECEIPT);
    public final Doc invoices = new Doc(KIND_INVOICE);
    /** The unclosed shift this one replaced; sent to the server with the start request. */
    public JSONObject previousUnclosed = null;
    /** Unclosed shifts the server reported, still to be shown to the employee. */
    public final List<String> unclosedWarnings = new ArrayList<>();

    public Shift(String id, String employeeName, long openedAt, boolean late) {
        this.id = id;
        this.employeeName = employeeName;
        this.openedAt = openedAt;
        this.late = late;
    }

    public Doc doc(String kind) {
        if (KIND_REPORT.equals(kind)) return report;
        if (KIND_RECEIPT.equals(kind)) return receipt;
        if (KIND_INVOICE.equals(kind)) return invoices;
        throw new IllegalArgumentException("unknown kind " + kind);
    }

    public JSONObject toJson() throws JSONException {
        JSONArray warnings = new JSONArray();
        for (String warning : unclosedWarnings) warnings.put(warning);
        JSONObject json = new JSONObject()
                .put("id", id).put("employeeName", employeeName).put("openedAt", openedAt).put("late", late)
                .put("status", status).put("serverConfirmed", serverConfirmed).put("syncError", syncError)
                .put("closedAt", closedAt)
                .put("report", report.toJson()).put("receipt", receipt.toJson()).put("invoices", invoices.toJson())
                .put("unclosedWarnings", warnings);
        if (previousUnclosed != null) json.put("previousUnclosed", previousUnclosed);
        return json;
    }

    public static Shift fromJson(JSONObject json) {
        Shift shift = new Shift(json.optString("id"), json.optString("employeeName"), json.optLong("openedAt"), json.optBoolean("late"));
        shift.status = json.optString("status", STATUS_OPEN);
        shift.serverConfirmed = json.optBoolean("serverConfirmed");
        shift.syncError = json.optString("syncError", "");
        shift.closedAt = json.optLong("closedAt");
        copy(shift.report, Doc.fromJson(KIND_REPORT, json.optJSONObject("report")));
        copy(shift.receipt, Doc.fromJson(KIND_RECEIPT, json.optJSONObject("receipt")));
        copy(shift.invoices, Doc.fromJson(KIND_INVOICE, json.optJSONObject("invoices")));
        shift.previousUnclosed = json.optJSONObject("previousUnclosed");
        JSONArray warnings = json.optJSONArray("unclosedWarnings");
        if (warnings != null) for (int i = 0; i < warnings.length(); i++) shift.unclosedWarnings.add(warnings.optString(i));
        return shift;
    }

    private static void copy(Doc target, Doc source) {
        target.status = source.status;
        target.photos.addAll(source.photos);
        target.problems.addAll(source.problems);
        target.error = source.error;
        target.errorRetryable = source.errorRetryable;
        target.fields = source.fields;
        target.sentCount = source.sentCount;
    }
}
