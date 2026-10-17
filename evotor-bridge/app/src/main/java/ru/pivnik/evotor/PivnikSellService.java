package ru.pivnik.evotor;

import android.util.Log;
import android.content.Intent;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;
import ru.evotor.framework.receipt.formation.event.ReturnPositionsForBarcodeRequestedEvent;
import ru.evotor.framework.receipt.formation.event.handler.service.SellIntegrationService;
import ru.pivnik.evotor.core.PivnikQr;

/**
 * Receives every barcode scanned while a SELL receipt is being formed
 * (action ru.evotor.event.sell.BARCODE_RECEIVED). No product is added for a PIVNIK code;
 * a guest card is opened through the SDK and binds only the receipt captured at the event.
 * Empty positions do not guarantee suppression of POS product lookup on every firmware;
 * that behaviour remains an explicit physical-till acceptance item.
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
            Receipt.Header receipt=ReceiptApi.getReceiptHeader(this,Receipt.Type.SELL);
            if (receipt==null) return null;
            startIntegrationActivity(new Intent(this,NativeCustomerActivity.class).putExtra("pivnik_receipt_uuid",receipt.getUuid()));
            return null;
        } catch (RuntimeException error) {
            Log.w(Bridge.TAG, "barcode handler failed; till continues normally");
            return null;
        }
    }
}
