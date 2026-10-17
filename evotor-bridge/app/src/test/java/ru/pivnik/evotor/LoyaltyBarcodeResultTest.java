package ru.pivnik.evotor;

import android.os.Bundle;
import android.os.Parcel;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import ru.evotor.framework.receipt.formation.event.ReturnPositionsForBarcodeRequestedEvent;

import static org.junit.Assert.*;

/** Checks the actual SDK wire format. Does not simulate the closed-source native POS. */
@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 28)
public final class LoyaltyBarcodeResultTest {
    @Test public void customerQrSurvivesSdkAndParcelWithoutBecomingProduct() {
        assertHandled("PIVNIK:synthetic_Qr_12345678");
    }

    @Test public void printedCodeHasSameHandledResult() {
        assertHandled("\u200bpvk-ab12-cd34\r\n");
    }

    @Test public void productAndInvalidCodesRemainAvailableToNativeLookup() {
        for (String barcode : new String[]{null, "4601234567893", "PIVNIK.invalid", "PIVNIK:short"}) {
            Bundle wire = parcel(LoyaltyBarcodeResult.forBarcode(barcode).toBundle());
            assertFalse(wire.containsKey("extra_positions_list_count"));
            ReturnPositionsForBarcodeRequestedEvent.Result decoded =
                    ReturnPositionsForBarcodeRequestedEvent.Result.from(wire);
            assertNotNull(decoded);
            assertTrue(decoded.getPositionsList().isEmpty());
            assertTrue(decoded.getPositions().isEmpty());
            assertFalse(decoded.getICanCreateNewProduct());
        }
    }

    @Test public void formerZeroGroupResultIsDifferentOnTheWire() {
        Bundle previous = new ReturnPositionsForBarcodeRequestedEvent.Result(false,
                java.util.Collections.emptyList(), java.util.Collections.emptyList()).toBundle();
        assertFalse(previous.containsKey("extra_positions_list_count"));
        Bundle changed = LoyaltyBarcodeResult.forBarcode("PIVNIK:synthetic_Qr_12345678").toBundle();
        assertEquals(1, changed.getInt("extra_positions_list_count"));
        assertEquals(0, changed.getInt("extra_sub_positions_count0"));
    }

    private static void assertHandled(String barcode) {
        Bundle wire = parcel(LoyaltyBarcodeResult.forBarcode(barcode).toBundle());
        assertEquals(0, wire.getInt("extra_positions_count"));
        assertEquals(1, wire.getInt("extra_positions_list_count"));
        assertTrue(wire.containsKey("extra_sub_positions_count0"));
        assertEquals(0, wire.getInt("extra_sub_positions_count0"));
        assertFalse(wire.getBoolean("extra_can_create_product"));
        ReturnPositionsForBarcodeRequestedEvent.Result decoded =
                ReturnPositionsForBarcodeRequestedEvent.Result.from(wire);
        assertNotNull(decoded);
        assertEquals(1, decoded.getPositionsList().size());
        assertTrue(decoded.getPositionsList().get(0).isEmpty());
        assertTrue(decoded.getPositions().isEmpty());
        assertFalse(decoded.getICanCreateNewProduct());
        for (String key : wire.keySet()) assertFalse(key.startsWith("extra_position_"));
    }

    private static Bundle parcel(Bundle value) {
        Parcel out = Parcel.obtain();
        Parcel in = Parcel.obtain();
        try {
            out.writeBundle(value);
            byte[] bytes = out.marshall();
            in.unmarshall(bytes, 0, bytes.length);
            in.setDataPosition(0);
            return in.readBundle(LoyaltyBarcodeResultTest.class.getClassLoader());
        } finally {
            out.recycle();
            in.recycle();
        }
    }
}
