package ru.pivnik.evotor;

import android.util.Log;
import java.util.Collections;
import ru.evotor.framework.receipt.formation.event.ReturnPositionsForBarcodeRequestedEvent;
import ru.evotor.framework.receipt.formation.event.handler.service.SellIntegrationService;
import ru.pivnik.evotor.core.PivnikQr;

/**
 * Receives every barcode scanned while a SELL receipt is being formed
 * (action ru.evotor.event.sell.BARCODE_RECEIVED). No product is added for a PIVNIK code;
 * the client is reported to the server against the open receipt UUID. Empty positions do not
 * guarantee suppression of the POS product lookup. Use CustomerScanActivity for customer scans.
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
            // No fictitious product. The POS may still display its own "product not found" message.
            return new ReturnPositionsForBarcodeRequestedEvent.Result(
                    false, Collections.emptyList(), Collections.emptyList());
        } catch (RuntimeException error) {
            Log.w(Bridge.TAG, "barcode handler failed; till continues normally");
            return null;
        }
    }
}
