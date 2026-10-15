package ru.pivnik.evotor;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
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
    private final Handler main = new Handler(Looper.getMainLooper());

    private Bridge(Context context) {
        app = context.getApplicationContext();
        PivnikTls.install(app);
        settings = new BridgeSettings(app);
        policy = new BindingPolicy(new PrefsBindingStore(app));
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
        worker.execute(new Runnable() {
            @Override public void run() {
                String message;
                try {
                    message = handleScan(payload);
                } catch (RuntimeException error) {
                    Log.w(TAG, "scan handling failed; sale continues without PIVNIK");
                    message = IndicatorText.forFailure(ResolveResult.Kind.UNAVAILABLE);
                }
                final String result = message;
                if (callback == null) notifyBartender(result);
                else main.post(new Runnable() {
                    @Override public void run() { callback.onResult(result); }
                });
            }
        });
    }

    private String handleScan(String payload) {
        Receipt.Header scanned = ReceiptApi.getReceiptHeader(app, Receipt.Type.SELL);
        if (scanned == null) {
            return IndicatorText.noOpenReceipt();
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
        BindingPolicy.Outcome outcome = policy.onCustomerResolved(
                scanned.getUuid(), current == null ? null : current.getUuid(), result.client, System.currentTimeMillis());
        if (outcome == BindingPolicy.Outcome.BOUND || outcome == BindingPolicy.Outcome.REPLACED
                || outcome == BindingPolicy.Outcome.ALREADY_BOUND) {
            // The server accrues only for receipts it was told about, so the bind must land.
            ResolveResult bound = PivnikApi.bind(settings, scanned.getUuid(), payload);
            settings.recordStatus("bind " + outcome + " " + bound.kind + " receipt " + scanned.getUuid());
            if (bound.kind != ResolveResult.Kind.FOUND) {
                policy.onReceiptFinished(scanned.getUuid());
                return IndicatorText.bindFailed(bound.kind);
            }
        } else {
            settings.recordStatus("bind " + outcome + " receipt " + scanned.getUuid());
        }
        return IndicatorText.forBinding(outcome, result.client, previous == null ? "" : previous.displayName);
    }

    void notifyBartender(final String text) {
        main.post(new Runnable() {
            @Override public void run() {
                Toast.makeText(app, text, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
