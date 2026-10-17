package ru.pivnik.evotor;

import java.util.Collections;
import java.util.List;
import ru.evotor.framework.receipt.Position;
import ru.evotor.framework.receipt.formation.event.ReturnPositionsForBarcodeRequestedEvent;
import ru.pivnik.evotor.core.PivnikQr;

/** Barcode integration result; never inserts a loyalty code as a receipt position. */
final class LoyaltyBarcodeResult {
    private LoyaltyBarcodeResult() {}

    static ReturnPositionsForBarcodeRequestedEvent.Result forBarcode(String barcode) {
        // v0.6.40 omits extra_positions_list_count for zero groups. POS then receives
        // the same shape as "no product found". A recognized loyalty scan instead
        // returns one explicit empty group, while unrelated codes retain zero groups.
        // Group support requires POS >= 6.35; native acceptance is verified separately.
        List<List<Position>> groups = PivnikQr.detect(barcode) == null
                ? Collections.emptyList()
                : Collections.singletonList(Collections.emptyList());
        return new ReturnPositionsForBarcodeRequestedEvent.Result(false, Collections.emptyList(), groups);
    }
}
