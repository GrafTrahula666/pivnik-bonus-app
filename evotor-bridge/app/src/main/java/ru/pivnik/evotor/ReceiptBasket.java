package ru.pivnik.evotor;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;
import ru.evotor.framework.receipt.Position;
import ru.evotor.framework.receipt.Receipt;

/** Local snapshot detects edits; only a closed cloud document authorizes settlement. */
final class ReceiptBasket {
    final String uuid, hash;
    final long beforeDocumentDiscountCents, documentDiscountCents;
    final boolean hasPayment;
    final boolean foreignLoyalty;
    final JSONObject extras;

    ReceiptBasket(Receipt receipt) throws Exception {
        if (receipt==null || receipt.getHeader().getType()!=Receipt.Type.SELL) throw new IllegalStateException("Откройте чек продажи.");
        uuid=receipt.getHeader().getUuid();
        BigDecimal sum=BigDecimal.ZERO;
        ArrayList<String> lines=new ArrayList<>();
        for (Position p:receipt.getPositions()) {
            sum=sum.add(p.getTotalWithSubPositionsAndWithoutDocumentDiscount());
            lines.add(positionKey(p));
        }
        Collections.sort(lines);
        StringBuilder fingerprint=new StringBuilder(uuid);
        for (String line:lines) fingerprint.append('\n').append(line.length()).append(':').append(line);
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(fingerprint.toString().getBytes(StandardCharsets.UTF_8));
        StringBuilder hex=new StringBuilder();
        for (byte b:digest) hex.append(String.format(java.util.Locale.ROOT,"%02x",b & 255));
        hash=hex.toString();
        beforeDocumentDiscountCents=sum.movePointRight(2).longValueExact();
        documentDiscountCents=receipt.getDiscount().movePointRight(2).longValueExact();
        if (beforeDocumentDiscountCents<0 || beforeDocumentDiscountCents>9007199254740991L || documentDiscountCents<0) throw new IllegalStateException("Проверьте сумму чека.");
        boolean paid=false;
        List<Receipt.PrintReceipt> groups=receipt.getPrintDocuments();
        for (Receipt.PrintReceipt group:groups) {
            Map<ru.evotor.framework.receipt.Payment,BigDecimal> payments=group.getPayments();
            for (BigDecimal value:payments.values()) if (value.signum()>0) paid=true;
        }
        hasPayment=paid;
        ru.evotor.framework.receipt.AppliedLoyaltyData applied=receipt.getHeader().getLoyaltyAppData();
        String data=applied==null ? null : applied.getAdditionalData();
        boolean hasLoyalty=applied!=null && (present(applied.getLoyaltyCardId()) || present(applied.getExternalLoyaltyCardId()) || present(data));
        // An unknown/other loyalty context is never overwritten or cleared.
        boolean own=false;
        try { own=present(data) && "70110ab9-7265-4a13-8320-fa164642b321".equals(new JSONObject(data).optString("loyaltyAppId","")); }
        catch (JSONException ignored) {}
        foreignLoyalty=hasLoyalty && !own;
        String raw=receipt.getHeader().getExtra();
        extras=raw==null || raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
    }

    private static boolean present(String value) { return value!=null && !value.isEmpty(); }

    private static String field(Object value) {
        String text=value==null ? "" : value instanceof BigDecimal ? ((BigDecimal)value).stripTrailingZeros().toPlainString() : value.toString();
        return text.length()+":"+text;
    }

    private static String positionKey(Position p) {
        // Never use Parcelable/Object.toString identity hashes: re-reading the
        // same provider row must produce the same basket fingerprint.
        StringBuilder key=new StringBuilder();
        for (Object value:new Object[]{p.getUuid(),p.getProductUuid(),p.getName(),p.getBarcode(),p.getQuantity(),p.getPrice(),
                p.getPriceWithDiscountPosition(),p.getAlcoholByVolume(),p.getAlcoholProductKindCode(),p.getTareVolume()}) key.append(field(value));
        List<Position> children=p.getSubPositions();
        ArrayList<String> nested=new ArrayList<>();
        if (children!=null) for (Position child:children) nested.add(positionKey(child));
        Collections.sort(nested); for (String child:nested) key.append(field(child));
        return key.toString();
    }

    boolean matches(ru.pivnik.evotor.core.RedemptionOperation op) {
        return uuid.equals(op.receiptUuid) && hash.equals(op.basketHash) && beforeDocumentDiscountCents==op.totalCents && !hasPayment && !foreignLoyalty;
    }

    boolean ownMarker(ru.pivnik.evotor.core.RedemptionOperation op) {
        JSONObject marker=extras.optJSONObject("pivnikLoyaltyV1");
        try { return marker!=null && marker.getInt("version")==1 && op.operationId.equals(marker.getString("operationId"))
                && ru.pivnik.evotor.core.RedemptionOperation.integer(marker,"points")==op.points; }
        catch (JSONException error) { return false; }
    }

    boolean removedMarker(ru.pivnik.evotor.core.RedemptionOperation op) {
        return ownMarker(op) && extras.optJSONObject("pivnikLoyaltyV1").optBoolean("removed",false);
    }
}
