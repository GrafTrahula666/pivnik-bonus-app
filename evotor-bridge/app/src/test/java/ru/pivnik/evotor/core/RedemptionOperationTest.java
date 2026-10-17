package ru.pivnik.evotor.core;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class RedemptionOperationTest {
    private RedemptionOperation op() {
        return new RedemptionOperation("12345678-1234-4123-8123-123456789abc","receipt-1","123","a".repeat(64),30,10000,"requested");
    }
    @Test public void restartKeepsTheExactIdempotencyKeyAndReceipt() throws Exception {
        RedemptionOperation first=op();
        RedemptionOperation restored=RedemptionOperation.fromJson(new JSONObject(first.toJson().toString()));
        assertTrue(first.matchesServer(restored.toJson()));
        assertEquals("requested",restored.phase);
        assertEquals(first.operationId,restored.phase("offered").operationId);
        assertEquals(first.points,restored.phase("removing").points);
    }
    @Test public void responseForAnotherReceiptOrAmountNeverApplies() throws Exception {
        JSONObject row=op().toJson();
        row.put("receiptUuid","receipt-2"); assertFalse(op().matchesServer(row));
        row=op().toJson(); row.put("points",29); assertFalse(op().matchesServer(row));
        row=op().toJson(); row.put("clientId","456"); assertFalse(op().matchesServer(row));
        row=op().toJson(); row.put("basketHash","b".repeat(64)); assertFalse(op().matchesServer(row));
    }
    @Test public void malformedUnsafeFractionalAndOverLimitValuesAreRejected() throws Exception {
        for (Object value:new Object[]{-1,0,31,0.5,9007199254740992L,"30",true}) {
            JSONObject row=op().toJson().put("points",value);
            try { RedemptionOperation.fromJson(row); fail("accepted "+value); } catch (Exception expected) {}
        }
        try { op().phase("completed"); fail(); } catch (IllegalArgumentException expected) {}
        try { RedemptionOperation.integer(new JSONObject().put("n",9007199254740992L),"n"); fail(); } catch (Exception expected) {}
    }
    @Test public void fractionalCentsLimitRoundsDownWithoutFloatingPoint() {
        new RedemptionOperation(op().operationId,"receipt-1","123","a".repeat(64),29,9999,"reserved");
        try { new RedemptionOperation(op().operationId,"receipt-1","123","a".repeat(64),30,9999,"reserved"); fail(); }
        catch (IllegalArgumentException expected) {}
    }
}
