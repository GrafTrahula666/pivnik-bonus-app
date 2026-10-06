package ru.pivnik.evotor;

import android.content.Context;
import android.util.Log;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;
import ru.evotor.framework.receipt.event.ReceiptCompletedEvent;
import ru.evotor.framework.receipt.event.ReceiptCreatedEvent;
import ru.evotor.framework.receipt.event.ReceiptDeletedEvent;
import ru.evotor.framework.receipt.event.handler.receiver.SellReceiptBroadcastReceiver;
import ru.pivnik.evotor.core.PivnikExtra;
import ru.pivnik.evotor.core.ReceiptBinding;

/**
 * Sell receipt lifecycle (evotor.intent.action.receipt.sell.OPENED / CLEARED / RECEIPT_CLOSED).
 * Guarantees the customer never carries over: deleted and closed receipts drop their binding,
 * and opening any other receipt drops a stale one. On close it reads the closed receipt back
 * through ReceiptApi to confirm the extra really landed in the document.
 */
public final class PivnikReceiptReceiver extends SellReceiptBroadcastReceiver {

    @Override
    protected void handleReceiptCreatedEvent(Context context, ReceiptCreatedEvent event) {
        try {
            Bridge.get(context).policy.onReceiptOpened(event.getReceiptUuid());
        } catch (RuntimeException error) {
            Log.w(Bridge.TAG, "receipt-opened handling failed");
        }
    }

    @Override
    protected void handleReceiptDeletedEvent(Context context, ReceiptDeletedEvent event) {
        try {
            Bridge.get(context).policy.onReceiptFinished(event.getReceiptUuid());
        } catch (RuntimeException error) {
            Log.w(Bridge.TAG, "receipt-deleted handling failed");
        }
    }

    @Override
    protected void handleReceiptCompletedEvent(Context context, ReceiptCompletedEvent event) {
        final String receiptUuid = event.getReceiptUuid();
        final Bridge bridge;
        final ReceiptBinding binding;
        try {
            bridge = Bridge.get(context);
            binding = bridge.policy.storedBinding();
        } catch (RuntimeException error) {
            Log.w(Bridge.TAG, "receipt-closed handling failed");
            return;
        }
        if (binding == null || !binding.receiptUuid.equals(receiptUuid)) {
            bridge.policy.onReceiptFinished(receiptUuid);
            return;
        }
        final PendingResult pending = goAsync();
        bridge.worker.execute(new Runnable() {
            @Override public void run() {
                try {
                    Receipt closed = ReceiptApi.getReceipt(bridge.app, receiptUuid);
                    String extra = closed == null ? null : closed.getHeader().getExtra();
                    boolean landed = PivnikExtra.carriesUser(extra, binding.userId);
                    bridge.settings.recordStatus("closed " + receiptUuid + (landed ? " extra OK" : " extra MISSING"));
                    if (!landed) bridge.notifyBartender("PIVNIK ⚠ клиент не сохранился в чеке");
                } catch (RuntimeException error) {
                    Log.w(Bridge.TAG, "closed-receipt verification failed");
                } finally {
                    bridge.policy.onReceiptFinished(receiptUuid);
                    pending.finish();
                }
            }
        });
    }
}
