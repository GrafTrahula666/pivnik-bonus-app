package ru.pivnik.evotor;

import android.content.ComponentName;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;
import ru.evotor.framework.receipt.formation.api.SellApi;
import ru.evotor.framework.receipt.formation.api.trigger_receipt_discount_event.TriggerReceiptDiscountEventCallback;
import ru.evotor.framework.receipt.formation.api.trigger_receipt_discount_event.TriggerReceiptDiscountEventException;
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

    private static Bridge instance;

    final Context app;
    final BridgeSettings settings;
    final BindingPolicy policy;
    final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private Bridge(Context context) {
        app = context.getApplicationContext();
        settings = new BridgeSettings(app);
        policy = new BindingPolicy(new PrefsBindingStore(app));
    }

    static synchronized Bridge get(Context context) {
        if (instance == null) instance = new Bridge(context);
        return instance;
    }

    /** Called from the barcode event with a code already recognised as a PIVNIK customer code. */
    void onPivnikCodeScanned(final String payload) {
        worker.execute(new Runnable() {
            @Override public void run() {
                try {
                    handleScan(payload);
                } catch (RuntimeException error) {
                    Log.w(TAG, "scan handling failed; sale continues without PIVNIK");
                    notifyBartender(IndicatorText.forFailure(ResolveResult.Kind.UNAVAILABLE));
                }
            }
        });
    }

    private void handleScan(String payload) {
        Receipt.Header scanned = ReceiptApi.getReceiptHeader(app, Receipt.Type.SELL);
        if (scanned == null) {
            notifyBartender(IndicatorText.noOpenReceipt());
            return;
        }
        if (!settings.isConfigured()) {
            notifyBartender(IndicatorText.notConfigured());
            return;
        }
        ResolveResult result = PivnikApi.resolve(settings, payload);
        if (result.kind != ResolveResult.Kind.FOUND) {
            settings.recordStatus("resolve " + result.kind);
            notifyBartender(IndicatorText.forFailure(result.kind));
            return;
        }
        // The receipt may have been closed/deleted while the backend answered: re-check it.
        Receipt.Header current = ReceiptApi.getReceiptHeader(app, Receipt.Type.SELL);
        ReceiptBinding previous = policy.storedBinding();
        BindingPolicy.Outcome outcome = policy.onCustomerResolved(
                scanned.getUuid(), current == null ? null : current.getUuid(), result.client, System.currentTimeMillis());
        settings.recordStatus("bind " + outcome + " receipt " + scanned.getUuid());
        notifyBartender(IndicatorText.forBinding(outcome, result.client, previous == null ? "" : previous.displayName));
        if (outcome == BindingPolicy.Outcome.BOUND || outcome == BindingPolicy.Outcome.REPLACED) {
            requestExtraWrite();
        }
    }

    /**
     * Asks the till to call our ReceiptDiscountEvent handler for the current sell receipt right
     * now (SellApi.triggerReceiptDiscountEvent), so the extra is set immediately after the scan.
     * If this POS build lacks the trigger, the same handler still runs at the payment step via
     * ReceiptDiscountRequiredEvent, and BeforePositionsEditedEvent writes it on later edits.
     */
    private void requestExtraWrite() {
        requestExtraWrite(true);
    }

    private void requestExtraWrite(final boolean retryIfBusy) {
        SellApi.triggerReceiptDiscountEvent(app, new ComponentName(app, PivnikReceiptService.class),
                new TriggerReceiptDiscountEventCallback() {
                    @Override public void onSuccess() {
                        Log.i(TAG, "receipt extra write triggered");
                    }

                    @Override public void onError(TriggerReceiptDiscountEventException error) {
                        Log.w(TAG, "trigger refused (code " + error.getCode() + "); extra will be written at payment step");
                        settings.recordStatus("trigger error " + error.getCode());
                        if (retryIfBusy && error.getCode() == TriggerReceiptDiscountEventException.ERROR_CODE_KKM_IS_BUSY) {
                            main.postDelayed(new Runnable() {
                                @Override public void run() {
                                    worker.execute(new Runnable() {
                                        @Override public void run() {
                                            requestExtraWrite(false);
                                        }
                                    });
                                }
                            }, 800);
                        }
                    }
                }, null);
    }

    void notifyBartender(final String text) {
        main.post(new Runnable() {
            @Override public void run() {
                Toast.makeText(app, text, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
