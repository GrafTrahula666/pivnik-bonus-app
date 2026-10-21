package ru.pivnik.evotor;

import org.json.JSONObject;
import java.util.List;
import java.util.Collections;
import ru.pivnik.evotor.core.RedemptionOperation;

/** Recovery is independent of the currently opened receipt and never applies a POS discount. */
final class RedemptionRecovery {
    interface Exchange { JSONObject request(JSONObject body) throws Exception; }
    interface DeletionProof { boolean confirmed(String receipt); }
    static int run(RedemptionJournal journal,Exchange exchange,DeletionProof proof) {
        int resolved=0;
        List<RedemptionOperation> pending=journal.operations();
        if (pending.isEmpty()) return 0;
        Collections.sort(pending,(a,b) -> a.receiptUuid.compareTo(b.receiptUuid));
        int limit=Math.min(16,pending.size()),start=journal.nextRecoveryOffset(pending.size(),limit);
        for (int i=0;i<limit;i++) {
            RedemptionOperation op=pending.get((start+i)%pending.size());
            try {
                JSONObject status=exchange.request(new JSONObject().put("action","status").put("receiptUuid",op.receiptUuid).put("operationId",op.operationId));
                JSONObject row=status.optJSONObject("redemption");
                if (row!=null && !op.matchesServer(row)) continue;
                if (row!=null && ("committed".equals(row.getString("state")) || "released".equals(row.getString("state")))) {
                    if (journal.clear(op.receiptUuid,op.operationId)) resolved++; continue;
                }
                if (!"deleted".equals(journal.lifecycle(op.receiptUuid)) || !proof.confirmed(op.receiptUuid)
                        || !"deleted".equals(journal.lifecycle(op.receiptUuid))) continue;
                // A CLEARED broadcast alone is untrusted. Both provider reads above must
                // affirmatively show absence, and a completed fence always takes precedence.
                JSONObject answer=exchange.request(new JSONObject().put("action","cancel").put("receiptUuid",op.receiptUuid)
                        .put("operationId",op.operationId).put("effectRemoved",true));
                row=answer.optJSONObject("redemption");
                boolean tombstone=row==null && op.operationId.equals(answer.optString("cancelledOperationId",""));
                if (tombstone || row!=null && op.matchesServer(row) && "released".equals(row.getString("state"))) {
                    if (journal.clear(op.receiptUuid,op.operationId)) resolved++;
                }
            } catch (Exception retryLater) { /* durable UUID/operation/lifecycle retained; never assume a refund */ }
        }
        return resolved;
    }
}
