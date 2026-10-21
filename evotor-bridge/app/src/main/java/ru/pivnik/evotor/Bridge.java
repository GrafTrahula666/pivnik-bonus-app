package ru.pivnik.evotor;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;
import ru.pivnik.evotor.core.BindingPolicy;
import ru.pivnik.evotor.core.IndicatorText;
import ru.pivnik.evotor.core.ReceiptBinding;
import ru.pivnik.evotor.core.ResolveResult;

/**
 * Process-wide state. Every Evotor callback returns immediately; network and receipt lookups run
 * on one background thread so a slow or absent backend can never hold up the sale.
 */
final class Bridge {
    static final String TAG = "PivnikEvotor";

    interface ScanCallback {
        void onResult(String message);
    }

    private static Bridge instance;

    final Context app;
    final BridgeSettings settings;
    final BindingPolicy policy;
    final ExecutorService worker = Executors.newSingleThreadExecutor();
    final ExecutorService recoveryWorker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean recovering=new AtomicBoolean();
    private final Handler main = new Handler(Looper.getMainLooper());

    private Bridge(Context context) {
        app = context.getApplicationContext();
        PivnikTls.install(app);
        settings = new BridgeSettings(app);
        policy = new BindingPolicy(new PrefsBindingStore(app));
        recoverRedemptions();
    }

    static synchronized Bridge get(Context context) {
        if (instance == null) instance = new Bridge(context);
        return instance;
    }

    /** Called from the barcode event with a code already recognised as a PIVNIK customer code. */
    void onPivnikCodeScanned(final String payload) {
        onPivnikCodeScanned(payload, null);
    }

    void onPivnikCodeScanned(final String payload, final ScanCallback callback) {
        onPivnikCodeScanned(payload, null, callback);
    }

    void onPivnikCodeScanned(final String payload, final String expectedReceipt, final ScanCallback callback) {
        final BindingPolicy.ScanTicket scanTicket = policy.beginScan(expectedReceipt);
        worker.execute(new Runnable() {
            @Override public void run() {
                String message;
                try {
                    message = handleScan(payload, expectedReceipt, scanTicket);
                } catch (RuntimeException error) {
                    Log.w(TAG, "scan handling failed; sale continues without PIVNIK");
                    message = IndicatorText.forFailure(ResolveResult.Kind.UNAVAILABLE);
                } finally { policy.endScan(scanTicket); }
                final String result = message;
                if (callback == null) notifyBartender(result);
                else main.post(new Runnable() {
                    @Override public void run() { callback.onResult(result); }
                });
            }
        });
    }

    private String handleScan(String payload, String expectedReceipt, BindingPolicy.ScanTicket scanTicket) {
        if (!policy.isScanCurrent(scanTicket)) return "Чек изменился. Отсканируйте QR клиента в новом чеке.";
        Receipt.Header scanned = ReceiptApi.getReceiptHeader(app, Receipt.Type.SELL);
        if (scanned == null) {
            return IndicatorText.noOpenReceipt();
        }
        if (!policy.acceptScanReceipt(scanTicket, scanned.getUuid())) return "Чек изменился. Выберите клиента в новом чеке.";
        if (expectedReceipt != null && !expectedReceipt.equals(scanned.getUuid())) {
            return "Чек изменился. Отсканируйте QR клиента заново в нужном чеке.";
        }
        if (!settings.isConfigured()) {
            return IndicatorText.notConfigured();
        }
        ResolveResult result = PivnikApi.resolve(settings, payload);
        if (result.kind != ResolveResult.Kind.FOUND) {
            settings.recordStatus("resolve " + result.kind);
            return IndicatorText.forFailure(result.kind);
        }
        // The receipt may have been closed/deleted while the backend answered: re-check it.
        Receipt.Header current = ReceiptApi.getReceiptHeader(app, Receipt.Type.SELL);
        ReceiptBinding previous = policy.storedBinding();
        if (previous != null && previous.receiptUuid.equals(scanned.getUuid())
                && !previous.userId.equals(result.client.userId) && new RedemptionJournal(app).get(scanned.getUuid()) != null) {
            return "В чеке уже есть списание. Сначала отмените его на экране оплаты, затем смените клиента.";
        }
        BindingPolicy.Outcome outcome = policy.onCustomerResolved(
                scanned.getUuid(), current == null ? null : current.getUuid(), result.client, System.currentTimeMillis(), scanTicket);
        if (outcome == BindingPolicy.Outcome.BOUND || outcome == BindingPolicy.Outcome.REPLACED
                || outcome == BindingPolicy.Outcome.ALREADY_BOUND) {
            // The server accrues only for receipts it was told about, so the bind must land.
            ResolveResult bound = PivnikApi.bind(settings, scanned.getUuid(), payload);
            settings.recordStatus("bind " + outcome + " " + bound.kind + " receipt " + scanned.getUuid());
            if (bound.kind != ResolveResult.Kind.FOUND) {
                policy.onReceiptFinished(scanned.getUuid());
                return IndicatorText.bindFailed(bound.kind);
            }
            Receipt.Header afterBind = ReceiptApi.getReceiptHeader(app, Receipt.Type.SELL);
            if (afterBind == null || !scanned.getUuid().equals(afterBind.getUuid()) || !policy.isScanCurrent(scanTicket)) {
                policy.onReceiptFinished(scanned.getUuid());
                return IndicatorText.forBinding(BindingPolicy.Outcome.RECEIPT_CHANGED, result.client, "");
            }
        } else {
            settings.recordStatus("bind " + outcome + " receipt " + scanned.getUuid());
        }
        return IndicatorText.forBinding(outcome, result.client, previous == null ? "" : previous.displayName);
    }

    /** Separate executor: an offline old receipt must not block scanning or a new sale. */
    void recoverRedemptions() {
        if (!settings.isConfigured()) return;
        try { if (new RedemptionJournal(app).operations().isEmpty()) return; }
        catch (RuntimeException unreadable) { Log.w(TAG,"saved redemption needs verification"); return; }
        if (!recovering.compareAndSet(false,true)) return;
        recoveryWorker.execute(() -> {
            try {
                RedemptionJournal journal=new RedemptionJournal(app);
                RedemptionRecovery.run(journal,body -> PivnikApi.redemption(settings,body),receipt -> DeletedReceiptProof.confirmed(app,receipt));
                int pending=journal.operations().size();
                settings.recordStatus(pending==0 ? "Сохранённые списания проверены." : "Есть незавершённые списания: "+pending+". Проверка повторится при открытии бонусов.");
            } finally { recovering.set(false); }
        });
    }

    /** Check actual receipt AFTER returning zero discount; never release on a timeout alone. */
    void retryRemovedRedemption(final String receiptUuid) {
        main.postDelayed(() -> worker.execute(() -> {
            try {
                RedemptionJournal journal=new RedemptionJournal(app);
                ru.pivnik.evotor.core.RedemptionOperation op=journal.get(receiptUuid);
                if (op==null || !"removing".equals(op.phase)) return;
                ReceiptBasket basket=new ReceiptBasket(ReceiptApi.getReceipt(app,Receipt.Type.SELL));
                if (!receiptUuid.equals(basket.uuid) || basket.hasPayment || basket.documentDiscountCents!=0 || !basket.removedMarker(op)) return;
                org.json.JSONObject reply=PivnikApi.redemption(settings,new org.json.JSONObject().put("action","cancel")
                    .put("receiptUuid",receiptUuid).put("operationId",op.operationId).put("effectRemoved",true));
                org.json.JSONObject row=reply.optJSONObject("redemption");
                if (row!=null && op.matchesServer(row) && "released".equals(row.getString("state"))) journal.clear(receiptUuid,op.operationId);
            } catch (Exception ignored) { /* durable journal retries when the tile is opened again */ }
        }),1000);
    }

    void notifyBartender(final String text) {
        main.post(new Runnable() {
            @Override public void run() {
                Toast.makeText(app, text, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
