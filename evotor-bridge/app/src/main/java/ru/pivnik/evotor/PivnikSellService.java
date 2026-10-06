package ru.pivnik.evotor;

import android.util.Log;
import java.util.Collections;
import ru.evotor.framework.receipt.formation.event.ReturnPositionsForBarcodeRequestedEvent;
import ru.evotor.framework.receipt.formation.event.handler.service.SellIntegrationService;
import ru.pivnik.evotor.core.PivnikQr;

/**
 * Receives every barcode scanned while a SELL receipt is being formed
 * (action ru.evotor.event.sell.BARCODE_RECEIVED). Its Result can only add positions —
 * the SDK offers no SetExtra here — so the extra is written later by PivnikReceiptService.
 *
 * <p>Payback receipts never reach this service, so a refund is never attributed to a customer.
 */
public final class PivnikSellService extends SellIntegrationService {

    @Override
    public ReturnPositionsForBarcodeRequestedEvent.Result handleEvent(ReturnPositionsForBarcodeRequestedEvent event) {
        try {
            // Per SDK contract the follow-up "create product" request must return null.
            if (event.getCreatingNewProduct()) return null;
            String payload = PivnikQr.detect(event.getBarcode());
            if (payload == null) return null; // not ours: the till handles the product code as usual
            Bridge.get(this).onPivnikCodeScanned(payload);
            // Claim the PIVNIK code without adding anything to the receipt.
            return new ReturnPositionsForBarcodeRequestedEvent.Result(
                    false, Collections.emptyList(), Collections.emptyList());
        } catch (RuntimeException error) {
            Log.w(Bridge.TAG, "barcode handler failed; till continues normally", error);
            return null;
        }
    }
}
