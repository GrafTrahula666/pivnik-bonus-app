package ru.pivnik.evotor;

import java.math.BigDecimal;
import java.util.Collections;
import ru.evotor.framework.receipt.AppliedLoyaltyData;
import ru.evotor.framework.receipt.Measure;
import ru.evotor.framework.receipt.Position;
import ru.evotor.framework.receipt.Receipt;
import org.junit.Test;
import static org.junit.Assert.*;

public class ReceiptBasketTest {
    private Receipt receipt(String quantity, BigDecimal paid, AppliedLoyaltyData loyalty) {
        return receipt(quantity,paid,loyalty,null);
    }
    private Receipt receipt(String quantity, BigDecimal paid, AppliedLoyaltyData loyalty, String extra) {
        Position position=Position.Builder.newInstance("position-1","product-1","Beer",new Measure("шт",0,0),
                new BigDecimal("100.00"),new BigDecimal(quantity)).build();
        Receipt.Header header=new Receipt.Header("receipt-1",null,null,Receipt.Type.SELL,null,null,null,extra,null,false,
                null,null,false,null,loyalty);
        Receipt.PrintReceipt group=new Receipt.PrintReceipt(null,Collections.singletonList(position),
                Collections.singletonMap(null,paid),Collections.emptyMap(),Collections.emptyMap());
        return new Receipt(header,Collections.singletonList(group));
    }
    @Test public void releaseRequiresObservedOwnRemovalMarkerNotJustAnEmptyDiscount() throws Exception {
        ReceiptBasket plain=new ReceiptBasket(receipt("1",BigDecimal.ZERO,null));
        ru.pivnik.evotor.core.RedemptionOperation op=new ru.pivnik.evotor.core.RedemptionOperation(
            "12345678-1234-4123-8123-123456789abc","receipt-1","123",plain.hash,30,10000,"removing");
        assertFalse(plain.removedMarker(op));
        String marker="{\"pivnikLoyaltyV1\":{\"version\":1,\"operationId\":\"12345678-1234-4123-8123-123456789abc\",\"points\":30,\"removed\":true}}";
        assertTrue(new ReceiptBasket(receipt("1",BigDecimal.ZERO,null,marker)).removedMarker(op));
    }
    @Test public void rereadingEquivalentProviderRowsKeepsFingerprint() throws Exception {
        ReceiptBasket one=new ReceiptBasket(receipt("1.0",BigDecimal.ZERO,null));
        ReceiptBasket two=new ReceiptBasket(receipt("1.000",BigDecimal.ZERO,null));
        assertEquals(one.hash,two.hash);
        assertEquals(10000,one.beforeDocumentDiscountCents);
        assertNotEquals(one.hash,new ReceiptBasket(receipt("2",BigDecimal.ZERO,null)).hash);
    }
    @Test public void zeroPaymentPlaceholderDoesNotBecomePartialPayment() throws Exception {
        assertFalse(new ReceiptBasket(receipt("1",BigDecimal.ZERO,null)).hasPayment);
        assertTrue(new ReceiptBasket(receipt("1",new BigDecimal("1.00"),null)).hasPayment);
    }
    @Test public void emptySdkLoyaltyObjectDoesNotBlockEveryUnlinkedReceipt() throws Exception {
        assertFalse(new ReceiptBasket(receipt("1",BigDecimal.ZERO,new AppliedLoyaltyData(null,null,null))).foreignLoyalty);
        assertTrue(new ReceiptBasket(receipt("1",BigDecimal.ZERO,new AppliedLoyaltyData("other-card",null,null))).foreignLoyalty);
        assertFalse(new ReceiptBasket(receipt("1",BigDecimal.ZERO,new AppliedLoyaltyData("ours",null,
            "{\"loyaltyAppId\":\"70110ab9-7265-4a13-8320-fa164642b321\"}"))).foreignLoyalty);
    }
}
