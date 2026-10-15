package ru.pivnik.evotor;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import ru.evotor.framework.device.scanner.event.BarcodeReceivedEvent;
import ru.evotor.framework.device.scanner.event.handler.receiver.ScannerBroadcastReceiver;
import ru.evotor.framework.navigation.NavigationApi;
import ru.pivnik.evotor.core.ForegroundScan;

/** Dedicated customer scan window; the sale screen's product lookup is not used for customer QR. */
public final class CustomerScanActivity extends Activity {
    private ForegroundScan scan;
    private TextView result;
    private boolean registered;
    private final ScannerBroadcastReceiver scanner = new ScannerBroadcastReceiver() {
        @Override protected void handleBarcodeReceivedEvent(Context context, BarcodeReceivedEvent event) {
            scan.barcode(event.getBarcode());
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final Bridge bridge = Bridge.get(this);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this);
        title.setText("PIVNIK — клиент к чеку");
        title.setTextSize(22);
        root.addView(title);
        TextView note = new TextView(this);
        note.setText("Добавьте товары в чек Эвотора, откройте это окно и отсканируйте QR клиента. "
                + "После подтверждения вернитесь к продаже и оплатите чек. "
                + "Начисление бонусов происходит после оплаты. Списание на кассе пока недоступно.");
        root.addView(note);
        result = new TextView(this);
        result.setTextSize(20);
        result.setPadding(0, pad, 0, pad);
        root.addView(result);
        scan = new ForegroundScan(new ForegroundScan.Resolver() {
            @Override public void resolve(String payload, final ForegroundScan.Completion completion) {
                bridge.onPivnikCodeScanned(payload, new Bridge.ScanCallback() {
                    @Override public void onResult(String message) { completion.complete(message); }
                });
            }
        }, new ForegroundScan.View() {
            @Override public void show(String message) { result.setText(message); }
        });
        Button back = new Button(this);
        back.setText("Вернуться к продаже");
        back.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                try {
                    startActivity(NavigationApi.createIntentForSellReceiptEdit(false));
                    finish();
                } catch (android.content.ActivityNotFoundException error) {
                    result.setText("Не удалось открыть продажу Эвотора. Вернитесь к чеку через меню кассы.");
                }
            }
        });
        root.addView(back);
        Button setup = new Button(this);
        setup.setText("Подключение кассы");
        setup.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                startActivity(new Intent(CustomerScanActivity.this, SettingsActivity.class));
            }
        });
        root.addView(setup);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override protected void onResume() {
        super.onResume();
        scan.resume();
        if (!Bridge.get(this).settings.isConfigured()) {
            result.setText("Откройте «Подключение кассы»: сначала проверьте связь без ключа, затем сохраните ключ кассы.");
        }
        try {
            registerReceiver(scanner, new IntentFilter(ScannerBroadcastReceiver.ACTION_BARCODE_RECEIVED),
                    ScannerBroadcastReceiver.SENDER_PERMISSION, null);
            registered = true;
        } catch (RuntimeException error) {
            result.setText("Не удалось включить сканер. Проверьте разрешение приложения на сканер Эвотора.");
        }
    }

    @Override protected void onPause() {
        scan.pause();
        if (registered) {
            unregisterReceiver(scanner);
            registered = false;
        }
        super.onPause();
    }
}
