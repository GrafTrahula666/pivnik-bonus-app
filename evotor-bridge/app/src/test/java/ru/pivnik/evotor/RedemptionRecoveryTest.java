package ru.pivnik.evotor;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;
import ru.pivnik.evotor.core.RedemptionOperation;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(manifest=Config.NONE,sdk={23,28})
public final class RedemptionRecoveryTest {
    private static final String A="11111111-aaaa-4aaa-8aaa-111111111111";
    private RedemptionJournal journal() { return new RedemptionJournal(RuntimeEnvironment.getApplication()); }
    private RedemptionOperation operation() { return new RedemptionOperation("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",A,"101",new String(new char[64]).replace('\0','a'),30,10000,"reserved"); }
    private JSONObject row(RedemptionOperation op,String state) throws Exception { return op.toJson().put("state",state); }

    @Test public void lifecycleSurvivesNewJournalInstanceAndCompletedAlwaysFencesDeletionAndLateSave() throws Exception {
        RedemptionOperation op=operation(); journal().save(op); journal().deleted(A);
        assertEquals("deleted",journal().lifecycle(A)); assertEquals(1,journal().operations().size());
        journal().completed(A); journal().deleted(A);
        assertEquals("completed",journal().lifecycle(A));
        try { journal().save(op.phase("offered")); fail("late SDK offer must be rejected"); }
        catch (IllegalStateException expected) {}
        AtomicInteger cancels=new AtomicInteger();
        assertEquals(0,RedemptionRecovery.run(journal(),body -> {
            if ("cancel".equals(body.getString("action"))) cancels.incrementAndGet();
            return new JSONObject().put("redemption",row(op,"reserved"));
        },uuid -> { fail("completed receipt is never probed for deletion"); return true; }));
        assertEquals(0,cancels.get()); assertEquals("completed",journal().lifecycle(A));
    }

    @Test public void absentCurrentReceiptOrDeletionHintWithoutProviderProofNeverCredits() throws Exception {
        RedemptionOperation op=operation(); journal().save(op);
        AtomicInteger cancels=new AtomicInteger(),proofs=new AtomicInteger();
        RedemptionRecovery.Exchange api=body -> {
            if ("cancel".equals(body.getString("action"))) cancels.incrementAndGet();
            return new JSONObject().put("redemption",row(op,"reserved"));
        };
        RedemptionRecovery.run(journal(),api,uuid -> { proofs.incrementAndGet(); return true; });
        assertEquals(0,proofs.get());
        journal().deleted(A);
        RedemptionRecovery.run(journal(),api,uuid -> false);
        assertEquals(0,cancels.get()); assertNotNull(journal().get(A));
    }

    @Test public void confirmedDeletedReceiptCancelsItsExactOperationAndLostResponseRetriesWithoutDoubleCredit() throws Exception {
        RedemptionOperation op=operation(); journal().save(op); journal().deleted(A);
        AtomicInteger credits=new AtomicInteger();
        RedemptionRecovery.Exchange api=body -> {
            assertEquals(A,body.getString("receiptUuid"));
            if ("status".equals(body.getString("action"))) return new JSONObject().put("redemption",row(op,credits.get()==0 ? "reserved" : "released"));
            assertEquals(op.operationId,body.getString("operationId")); assertTrue(body.getBoolean("effectRemoved"));
            credits.incrementAndGet(); throw new IOException("lost response");
        };
        assertEquals(0,RedemptionRecovery.run(journal(),api,uuid -> A.equals(uuid)));
        assertNotNull(journal().get(A)); assertEquals(1,credits.get());
        assertEquals(1,RedemptionRecovery.run(journal(),api,uuid -> A.equals(uuid)));
        assertNull(journal().get(A)); assertEquals(1,credits.get());
    }

    @Test public void cancellationBeforeDelayedReserveRequiresTheMatchingDurableTombstone() throws Exception {
        RedemptionOperation op=operation(); journal().save(op); journal().deleted(A);
        assertEquals(0,RedemptionRecovery.run(journal(),body -> new JSONObject().put("cancelledOperationId","wrong"),uuid -> true));
        assertNotNull(journal().get(A));
        assertEquals(1,RedemptionRecovery.run(journal(),body -> new JSONObject().put("cancelledOperationId",op.operationId),uuid -> true));
        assertNull(journal().get(A));
    }

    @Test public void staleRecoveryCannotEraseANewerOperationForTheSameReceipt() throws Exception {
        RedemptionOperation first=operation(); journal().save(first);
        RedemptionOperation newer=new RedemptionOperation("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",A,"101",first.basketHash,20,10000,"requested");
        assertEquals(0,RedemptionRecovery.run(journal(),body -> {
            assertTrue(journal().clear(A,first.operationId)); journal().save(newer);
            return new JSONObject().put("redemption",row(first,"released"));
        },uuid -> false));
        assertEquals(newer.operationId,journal().get(A).operationId);
    }

    @Test public void terminalOperationAndLifecycleFencesRejectLateReserveResponseAfterCleanup() throws Exception {
        RedemptionOperation op=operation(); journal().save(op); journal().completed(A);
        assertTrue(journal().clear(A,op.operationId)); assertEquals("completed",journal().lifecycle(A));
        try { journal().save(op.phase("offered")); fail("completed cannot resurrect"); } catch (IllegalStateException expected) {}
    }

    @Test public void releasedOperationIdCannotResurrectButNewOperationOnSameOpenReceiptCanStart() throws Exception {
        RedemptionOperation op=operation(); journal().save(op); assertTrue(journal().clear(A,op.operationId));
        try { journal().save(op); fail("old operation cannot resurrect"); } catch (IllegalStateException expected) {}
        RedemptionOperation next=new RedemptionOperation("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",A,"101",op.basketHash,20,10000,"requested");
        journal().save(next); assertEquals(next.operationId,journal().get(A).operationId);
    }

    @Test public void boundedRecoveryRotatesPastUnresolvedOldReceipts() throws Exception {
        for(int i=0;i<20;i++) journal().save(new RedemptionOperation(String.format(java.util.Locale.ROOT,"%08x-bbbb-4ccc-8ddd-eeeeeeeeeeee",i+1),"receipt-"+i,"101",operation().basketHash,20,10000,"requested"));
        java.util.Set<String> seen=new java.util.HashSet<>();
        RedemptionRecovery.Exchange api=body -> { assertTrue(body.has("operationId"));seen.add(body.getString("receiptUuid"));return new JSONObject(); };
        RedemptionRecovery.run(journal(),api,uuid -> false); RedemptionRecovery.run(journal(),api,uuid -> false);
        assertEquals(20,seen.size());
    }

    @Test public void finalizedServerOperationClearsOnlyItsOwnJournal() throws Exception {
        RedemptionOperation op=operation(); journal().save(op); journal().completed(A);
        assertEquals(0,RedemptionRecovery.run(journal(),body -> new JSONObject().put("redemption",row(op,"committed").put("clientId","999")),uuid -> true));
        assertNotNull(journal().get(A));
        assertEquals(1,RedemptionRecovery.run(journal(),body -> new JSONObject().put("redemption",row(op,"committed")),uuid -> false));
        assertNull(journal().get(A));
    }

    @Test public void providerProofNeedsTwoSuccessfulEmptyExactUuidQueriesAndClosesBothCursors() {
        Probe receipts=new Probe(false,false,false),fiscal=new Probe(false,false,true);
        register(receipts,fiscal);
        assertTrue(DeletedReceiptProof.confirmed(RuntimeEnvironment.getApplication(),A));
        assertEquals("/receipts/"+A,receipts.lastUri.getPath());
        assertEquals("/receipt",fiscal.lastUri.getPath()); assertArrayEquals(new String[]{A},fiscal.args);
        assertEquals(1,receipts.closed.get()); assertEquals(1,fiscal.closed.get());
    }

    @Test public void existingOrInaccessibleReceiptAndFiscalRowsBlockCreditEvenForForgedDeletionHint() {
        for (int mode=0;mode<4;mode++) {
            register(new Probe(mode==0,mode==1,false),new Probe(mode==2,mode==3,true));
            assertFalse(DeletedReceiptProof.confirmed(RuntimeEnvironment.getApplication(),A));
        }
    }
    private void register(Probe receipts,Probe fiscal) {
        ShadowContentResolver.registerProviderInternal("ru.evotor.evotorpos.v2.receipt",receipts);
        ShadowContentResolver.registerProviderInternal("ru.evotor.framework.document.fiscal",fiscal);
    }
    private static final class Probe extends ContentProvider {
        final boolean existing,unavailable,fiscal; final AtomicInteger closed=new AtomicInteger(); Uri lastUri; String[] args;
        Probe(boolean existing,boolean unavailable,boolean fiscal) { this.existing=existing;this.unavailable=unavailable;this.fiscal=fiscal; }
        public boolean onCreate(){return true;}
        public Cursor query(Uri uri,String[] projection,String selection,String[] selectionArgs,String sort){
            lastUri=uri;args=selectionArgs; if(unavailable)return null;
            MatrixCursor cursor=new MatrixCursor(new String[]{"UUID"}) { @Override public void close(){super.close();closed.incrementAndGet();} };
            if(existing)cursor.addRow(new Object[]{A}); return cursor;
        }
        public String getType(Uri uri){return null;}
        public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
        public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
        public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
    }
}
