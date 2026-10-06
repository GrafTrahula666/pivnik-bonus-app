package ru.pivnik.evotor;

import android.content.ComponentName;
import android.os.RemoteException;
import android.util.Log;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import ru.evotor.framework.core.IntegrationService;
import ru.evotor.framework.core.action.event.receipt.before_positions_edited.BeforePositionsEditedEvent;
import ru.evotor.framework.core.action.event.receipt.before_positions_edited.BeforePositionsEditedEventProcessor;
import ru.evotor.framework.core.action.event.receipt.before_positions_edited.BeforePositionsEditedEventResult;
import ru.evotor.framework.core.action.event.receipt.changes.position.IPositionChange;
import ru.evotor.framework.core.action.event.receipt.changes.receipt.SetExtra;
import ru.evotor.framework.core.action.event.receipt.discount.ReceiptDiscountEvent;
import ru.evotor.framework.core.action.event.receipt.discount.ReceiptDiscountEventProcessor;
import ru.evotor.framework.core.action.event.receipt.discount.ReceiptDiscountEventResult;
import ru.evotor.framework.core.action.event.receipt.discount_required.ReceiptDiscountRequiredEvent;
import ru.evotor.framework.core.action.event.receipt.discount_required.ReceiptDiscountRequiredEventProcessor;
import ru.evotor.framework.core.action.event.receipt.discount_required.ReceiptDiscountRequiredEventResult;
import ru.evotor.framework.core.action.processor.ActionProcessor;
import ru.pivnik.evotor.core.PivnikExtra;
import ru.pivnik.evotor.core.ReceiptBinding;

/**
 * Writes the PIVNIK extra into the SELL receipt it belongs to. Three official SDK points, all
 * returning SetExtra, all keyed by the receipt UUID the till passes in:
 *
 * <ol>
 *   <li>ReceiptDiscountEvent ({@code evo.v2.receipt.sell.receiptDiscount}) — invoked on demand
 *       right after a verified scan via SellApi.triggerReceiptDiscountEvent, and again at the
 *       payment step. Returns a ZERO discount: this app never changes prices.</li>
 *   <li>ReceiptDiscountRequiredEvent ({@code evo.v2.receipt.sell.receiptDiscountRequiredEvent}) —
 *       sent on the move to the payment-type screen; we name our service only while a binding
 *       exists, so ordinary sales are untouched.</li>
 *   <li>BeforePositionsEditedEvent ({@code evo.v2.receipt.sell.beforePositionsEdited}) — re-writes
 *       the same extra when positions change after the scan; carries no money fields at all.</li>
 * </ol>
 *
 * <p>Any failure skips: the till then proceeds exactly as without this app.
 */
public final class PivnikReceiptService extends IntegrationService {

    @Override
    protected Map<String, ActionProcessor> createProcessors() {
        Map<String, ActionProcessor> processors = new HashMap<>();

        processors.put(ReceiptDiscountEvent.NAME_SELL_RECEIPT, new ReceiptDiscountEventProcessor() {
            @Override
            public void call(String action, ReceiptDiscountEvent event, Callback callback) {
                ReceiptBinding binding = bindingFor(event.getReceiptUuid());
                if (binding == null) {
                    skip(callback);
                    return;
                }
                try {
                    callback.onResult(new ReceiptDiscountEventResult(
                            BigDecimal.ZERO,
                            new SetExtra(PivnikExtra.toJson(binding)),
                            new ArrayList<IPositionChange>(),
                            null));
                } catch (RemoteException | RuntimeException error) {
                    Log.w(Bridge.TAG, "discount-event extra write failed");
                    skip(callback);
                }
            }
        });

        processors.put(ReceiptDiscountRequiredEvent.NAME_SELL_RECEIPT, new ReceiptDiscountRequiredEventProcessor() {
            @Override
            public void call(String action, ReceiptDiscountRequiredEvent event, ActionProcessor.Callback callback) {
                try {
                    // This event carries no receipt UUID; the exact UUID match happens in the
                    // ReceiptDiscountEvent the till sends to the component named here.
                    if (!Bridge.get(PivnikReceiptService.this).policy.hasActiveBinding(System.currentTimeMillis())) {
                        skip(callback);
                        return;
                    }
                    callback.onResult(new ReceiptDiscountRequiredEventResult(
                            new ComponentName(getApplicationContext(), PivnikReceiptService.class)));
                } catch (RemoteException | RuntimeException error) {
                    Log.w(Bridge.TAG, "discount-required answer failed");
                    skip(callback);
                }
            }
        });

        processors.put(BeforePositionsEditedEvent.NAME_SELL_RECEIPT, new BeforePositionsEditedEventProcessor() {
            @Override
            public void call(String action, BeforePositionsEditedEvent event, Callback callback) {
                ReceiptBinding binding = bindingFor(event.getReceiptUuid());
                if (binding == null) {
                    skip(callback);
                    return;
                }
                try {
                    callback.onResult(new BeforePositionsEditedEventResult(
                            null, new SetExtra(PivnikExtra.toJson(binding)), null));
                } catch (RemoteException | RuntimeException error) {
                    Log.w(Bridge.TAG, "positions-edited extra write failed");
                    skip(callback);
                }
            }
        });

        return processors;
    }

    private ReceiptBinding bindingFor(String receiptUuid) {
        try {
            return Bridge.get(this).policy.bindingFor(receiptUuid, System.currentTimeMillis());
        } catch (RuntimeException error) {
            Log.w(Bridge.TAG, "binding lookup failed");
            return null;
        }
    }

    private static void skip(ActionProcessor.Callback callback) {
        try {
            callback.skip();
        } catch (RemoteException | RuntimeException error) {
            Log.w(Bridge.TAG, "skip failed");
        }
    }
}
