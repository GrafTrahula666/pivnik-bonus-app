package ru.pivnik.evotor.core;

import org.json.JSONException;
import org.json.JSONObject;

/** Outcome of asking the PIVNIK backend who a scanned code belongs to. */
public final class ResolveResult {
    public enum Kind {
        /** Backend confirmed a customer. */
        FOUND,
        /** Backend answered: no such (or revoked) code. */
        NOT_FOUND,
        /** The till's credential was refused (401/403/428). */
        UNAUTHORIZED,
        /** Rate limited (429). */
        RATE_LIMITED,
        /** The receipt was already settled for another client (409). */
        CONFLICT,
        /** No connection, timeout, 5xx or an unreadable answer. Sale continues without PIVNIK. */
        UNAVAILABLE
    }

    public final Kind kind;
    public final ResolvedClient client;

    private ResolveResult(Kind kind, ResolvedClient client) {
        this.kind = kind;
        this.client = client;
    }

    public static ResolveResult unavailable() {
        return new ResolveResult(Kind.UNAVAILABLE, null);
    }

    /**
     * Interprets the device resolve/bind answer:
     * {@code {"qrToken","shortCode","client":{"id","firstName",...}}} on 200, {@code {"error"}} otherwise.
     */
    public static ResolveResult fromHttp(int status, String body) {
        if (status == 404) return new ResolveResult(Kind.NOT_FOUND, null);
        if (status == 401 || status == 403 || status == 428) return new ResolveResult(Kind.UNAUTHORIZED, null);
        if (status == 429) return new ResolveResult(Kind.RATE_LIMITED, null);
        if (status == 409) return new ResolveResult(Kind.CONFLICT, null);
        if (status != 200 || body == null) return unavailable();
        try {
            JSONObject client = new JSONObject(body).optJSONObject("client");
            if (client == null) return unavailable();
            String id = client.optString("id", "");
            String name = client.optString("firstName", "");
            return new ResolveResult(Kind.FOUND, new ResolvedClient(id, name));
        } catch (JSONException | IllegalArgumentException error) {
            return unavailable();
        }
    }
}
