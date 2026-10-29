package ru.pivnik.evotor;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;

/** Corroborate a deletion hint with BOTH real Evotor providers. No row/null/error is inferred from another receipt. */
final class DeletedReceiptProof {
    // Exact URIs and selectionArgs from ReceiptApi v0.6.40 getReceipt(uuid)/getFiscalReceipts(uuid).
    static boolean confirmed(Context app,String receipt) {
        if (receipt==null || !receipt.matches("[A-Za-z0-9-]{1,200}")) return false;
        try (Cursor header=app.getContentResolver().query(Uri.parse("content://ru.evotor.evotorpos.v2.receipt/receipts/"+receipt),null,null,null,null)) {
            if (header==null || header.getColumnIndex("UUID")<0 || header.moveToFirst()) return false;
        } catch (RuntimeException unavailable) { return false; }
        try (Cursor fiscal=app.getContentResolver().query(Uri.parse("content://ru.evotor.framework.document.fiscal/receipt"),null,null,new String[]{receipt},null)) {
            return fiscal!=null && !fiscal.moveToFirst();
        } catch (RuntimeException unavailable) { return false; }
    }
}
