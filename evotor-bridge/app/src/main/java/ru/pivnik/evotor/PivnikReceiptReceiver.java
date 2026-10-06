package ru.pivnik.evotor;

import android.content.Context;
import android.util.Log;
import ru.evotor.framework.receipt.event.ReceiptCompletedEvent;
import ru.evotor.framework.receipt.event.ReceiptCreatedEvent;
import ru.evotor.framework.receipt.event.ReceiptDeletedEvent;
import ru.evotor.framework.receipt.event.handler.receiver.SellReceiptBroadcastReceiver;
import ru.pivnik.evotor.core.ReceiptBinding;

/**
 * Sell receipt lifecycle (evotor.intent.action.receipt.sell.OPENED / CLEARED / RECEIPT_CLOSED).
 * Guarantees the customer never carries over: deleted and closed receipts drop their binding,
 * and opening any other receipt drops a stale one. Bonuses are settled by the server from the
 * closed cloud document, so nothing here touches the receipt.
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
        try {
            Bridge bridge = Bridge.get(context);
            ReceiptBinding binding = bridge.policy.storedBinding();
            if (binding != null && binding.receiptUuid.equals(event.getReceiptUuid())) {
                bridge.settings.recordStatus("closed " + event.getReceiptUuid() + " client " + binding.userId);
            }
            bridge.policy.onReceiptFinished(event.getReceiptUuid());
        } catch (RuntimeException error) {
            Log.w(Bridge.TAG, "receipt-closed handling failed");
        }
    }
}
