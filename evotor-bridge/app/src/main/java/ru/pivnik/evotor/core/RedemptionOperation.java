package ru.pivnik.evotor.core;

import org.json.JSONException;
import org.json.JSONObject;

/** Persisted BEFORE sending a reserve request, and before yielding its discount to the POS. */
public final class RedemptionOperation {
    public static final long MAX_SAFE = 9007199254740991L;
    public final String operationId, receiptUuid, clientId, basketHash, phase;
    public final long points, totalCents;

    public RedemptionOperation(String operationId, String receiptUuid, String clientId, String basketHash,
                               long points, long totalCents, String phase) {
        if (operationId == null || !operationId.matches("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
                || receiptUuid == null || !receiptUuid.matches("[A-Za-z0-9-]{1,200}")
                || clientId == null || !clientId.matches("[0-9]{1,20}")
                || basketHash == null || !basketHash.matches("[a-f0-9]{64}")
                || totalCents < 1 || totalCents > MAX_SAFE || points < 1
                || points > new java.math.BigInteger(Long.toString(totalCents)).multiply(java.math.BigInteger.valueOf(30))
                    .divide(java.math.BigInteger.valueOf(10000)).longValue()
                || !("requested".equals(phase) || "reserved".equals(phase) || "offered".equals(phase) || "removing".equals(phase))) {
            throw new IllegalArgumentException("Invalid redemption operation");
        }
        this.operationId=operationId; this.receiptUuid=receiptUuid; this.clientId=clientId; this.basketHash=basketHash;
        this.points=points; this.totalCents=totalCents; this.phase=phase;
    }

    public RedemptionOperation phase(String next) {
        return new RedemptionOperation(operationId,receiptUuid,clientId,basketHash,points,totalCents,next);
    }

    public JSONObject toJson() throws JSONException {
        return new JSONObject().put("operationId",operationId).put("receiptUuid",receiptUuid).put("clientId",clientId)
                .put("basketHash",basketHash).put("points",points).put("totalCents",totalCents).put("phase",phase);
    }

    public static RedemptionOperation fromJson(JSONObject json) throws JSONException {
        return new RedemptionOperation(json.getString("operationId"),json.getString("receiptUuid"),json.getString("clientId"),
                json.getString("basketHash"),integer(json,"points"),integer(json,"totalCents"),json.getString("phase"));
    }

    public boolean matchesServer(JSONObject row) throws JSONException {
        return row != null && operationId.equals(row.getString("operationId")) && receiptUuid.equals(row.getString("receiptUuid"))
                && clientId.equals(row.getString("clientId")) && basketHash.equals(row.getString("basketHash"))
                && points==integer(row,"points") && totalCents==integer(row,"totalCents");
    }

    public static long integer(JSONObject json, String key) throws JSONException {
        Object value=json.get(key);
        if (!(value instanceof Number) || !value.toString().matches("[0-9]{1,16}")) throw new JSONException("Invalid integer");
        long n=Long.parseLong(value.toString());
        if (n>MAX_SAFE) throw new JSONException("Unsafe integer");
        return n;
    }
}
