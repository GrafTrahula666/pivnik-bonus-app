package ru.pivnik.evotor;

import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import ru.evotor.framework.core.IntegrationActivity;
import ru.evotor.framework.receipt.formation.event.ReturnPositionsForBarcodeRequestedEvent;
import ru.pivnik.evotor.core.PivnikQr;

/** Guest card launched by the native sale barcode event, not by the app launcher. */
public final class NativeCustomerActivity extends IntegrationActivity {
    private String sourceBarcode;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        int pad=(int)(24*getResources().getDisplayMetrics().density);
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(pad,pad,pad,pad);
        TextView title=new TextView(this); title.setText("PIVNIK · Клиент к чеку"); title.setTextSize(24); root.addView(title);
        TextView status=new TextView(this); status.setTextSize(22); status.setPadding(0,pad,0,pad); status.setText("Проверяем клиента и баланс…"); root.addView(status);
        TextView note=new TextView(this); note.setText("После привязки клиента просто оплатите чек — бонусы начислятся после оплаты. Для списания выберите «Списать баллы» на экране оплаты."); root.addView(note);
        Button back=new Button(this); back.setText("Продолжить продажу"); back.setOnClickListener(v -> finish()); root.addView(back); setContentView(root);
        ReturnPositionsForBarcodeRequestedEvent event=ReturnPositionsForBarcodeRequestedEvent.from(getSourceBundle());
        sourceBarcode=event==null ? null : event.getBarcode();
        String payload=PivnikQr.detect(sourceBarcode);
        String receipt=getIntent().getStringExtra("pivnik_receipt_uuid");
        if (payload==null || receipt==null) { status.setText("Чек изменился. Отсканируйте QR клиента в открытой продаже."); return; }
        Bridge.get(this).onPivnikCodeScanned(payload,receipt,message -> {
            if (!isFinishing() && !isDestroyed()) status.setText(message);
        });
    }

    @Override public void finish() {
        setIntegrationResult(LoyaltyBarcodeResult.forBarcode(sourceBarcode));
        super.finish();
    }
}
