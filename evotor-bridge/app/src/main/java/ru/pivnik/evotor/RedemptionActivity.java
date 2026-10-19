package ru.pivnik.evotor;

import android.content.Context;
import android.content.IntentFilter;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.HorizontalScrollView;
import java.util.ArrayList;
import java.util.List;
import android.widget.ScrollView;
import android.widget.TextView;
import java.math.BigDecimal;
import java.util.Collections;
import java.util.UUID;
import org.json.JSONObject;
import ru.evotor.framework.core.IntegrationActivity;
import ru.evotor.framework.core.action.event.receipt.changes.receipt.SetExtra;
import ru.evotor.framework.core.action.event.receipt.discount.ReceiptDiscountEvent;
import ru.evotor.framework.core.action.event.receipt.discount.ReceiptDiscountEventResult;
import ru.evotor.framework.device.scanner.event.BarcodeReceivedEvent;
import ru.evotor.framework.device.scanner.event.handler.receiver.ScannerBroadcastReceiver;
import ru.evotor.framework.receipt.AppliedLoyaltyData;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;
import ru.pivnik.evotor.core.ReceiptBinding;
import ru.pivnik.evotor.core.RedemptionOperation;
import ru.pivnik.evotor.core.PivnikQr;

/** Explicit cashier-selected native discount tile. Never creates a fictitious payment/product. */
public final class RedemptionActivity extends IntegrationActivity {
    private Bridge bridge;
    private RedemptionJournal journal;
    private String receiptUuid;
    private TextView status, customer, scanStatus, volumeStatus;
    private final List<Button> volumeButtons=new ArrayList<>();
    private int beerMl;
    private String beerClient;
    private long beerBoundAt;
    private EditText amount, customerCode;
    private Button apply, remove, refresh, back, findCustomer, pay;
    private boolean busy;
    private boolean foreground, registered, returningEffect, callbackCompleted;
    private ReceiptBasket basket;
    private ReceiptBinding guest;
    private RedemptionOperation operation;
    private long maxPoints;
    private final ScannerBroadcastReceiver scanner = new ScannerBroadcastReceiver() {
        @Override protected void handleBarcodeReceivedEvent(Context context, BarcodeReceivedEvent event) {
            scanCustomer(event.getBarcode());
        }
    };

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        bridge=Bridge.get(this); journal=new RedemptionJournal(this);
        ReceiptDiscountEvent event=ReceiptDiscountEvent.create(getSourceBundle());
        receiptUuid=event==null ? null : event.getReceiptUuid();
        int pad=(int)(20*getResources().getDisplayMetrics().density);
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(pad,pad,pad,pad);
        root.setFocusableInTouchMode(true);
        TextView title=new TextView(this); title.setText("PIVNIK — БОНУСЫ"); title.setTextSize(24); root.addView(title);
        TextView note=new TextView(this); note.setText("Отсканируйте QR-код клиента"); note.setTextSize(22); root.addView(note);
        customer=new TextView(this); customer.setTextSize(22); customer.setPadding(0,pad,0,pad); root.addView(customer);
        customerCode=new EditText(this); customerCode.setSingleLine(true); customerCode.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        customerCode.setHint("Код клиента PVK-XXXX-XXXX или QR-код"); root.addView(customerCode);
        findCustomer=new Button(this); findCustomer.setText("Найти клиента"); findCustomer.setOnClickListener(v -> scanCustomer(customerCode.getText().toString())); root.addView(findCustomer);
        scanStatus=new TextView(this); root.addView(scanStatus);
        volumeStatus=new TextView(this); volumeStatus.setTextSize(18); root.addView(volumeStatus);
        HorizontalScrollView volumes=new HorizontalScrollView(this);
        LinearLayout row=new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL);
        int width=(int)(72*getResources().getDisplayMetrics().density);
        for (int ml=0;ml<=20000;ml+=500) {
            final int choice=ml;
            Button button=new Button(this); button.setText(ml==0 ? "0 л" : liters(ml)+" л");
            button.setOnClickListener(v -> { beerMl=choice; showVolume(); });
            row.addView(button,new LinearLayout.LayoutParams(width,LinearLayout.LayoutParams.WRAP_CONTENT)); volumeButtons.add(button);
        }
        volumes.addView(row); root.addView(volumes);
        TextView rule=new TextView(this); rule.setText("Выберите общий оплаченный объём разливного пива в чеке. 14 л → 1 л в подарок. Литры и бонусы учитываются после оплаты. Ряд можно прокрутить вправо."); root.addView(rule);
        back=new Button(this); back.setText("Перейти к оплате"); back.setOnClickListener(v -> checkoutOrdinary()); root.addView(back);
        TextView spending=new TextView(this); spending.setText("Списание баллов"); spending.setTextSize(24); spending.setPadding(0,pad,0,0); root.addView(spending);
        status=new TextView(this); status.setTextSize(18); status.setPadding(0,pad/2,0,pad/2); root.addView(status);
        amount=new EditText(this); amount.setInputType(InputType.TYPE_CLASS_NUMBER); amount.setHint("Сколько баллов списать"); root.addView(amount);
        apply=new Button(this); apply.setText("Списать баллы"); apply.setOnClickListener(v -> reserve()); root.addView(apply);
        remove=new Button(this); remove.setText("Отменить списание"); remove.setOnClickListener(v -> cancel()); root.addView(remove);
        refresh=new Button(this); refresh.setText("Обновить"); refresh.setOnClickListener(v -> load()); root.addView(refresh);
        pay=new Button(this); pay.setText("Оплата"); pay.setOnClickListener(v -> payReserved()); root.addView(pay);
        TextView paymentNote=new TextView(this); paymentNote.setText("«Оплата» — для выбранного списания. Без списания используйте «Перейти к оплате» выше. Клиент и объём выбираются заново в каждом чеке."); root.addView(paymentNote);
        ScrollView scroll=new ScrollView(this); scroll.addView(root); setContentView(scroll);
        root.requestFocus();
        load();
    }

    private ReceiptBasket current() throws Exception {
        Receipt receipt=ReceiptApi.getReceipt(this,Receipt.Type.SELL);
        ReceiptBasket found=new ReceiptBasket(receipt);
        if (receiptUuid==null || !receiptUuid.equals(found.uuid)) throw new IllegalStateException("Чек изменился. Вернитесь к продаже и откройте списание снова.");
        return found;
    }

    private JSONObject request(String action) throws Exception {
        return new JSONObject().put("action",action).put("receiptUuid",receiptUuid);
    }

    private void controls(boolean waiting) {
        busy=waiting; apply.setEnabled(!waiting && basket!=null && (operation!=null || maxPoints>0));
        remove.setEnabled(!waiting && operation!=null); amount.setEnabled(!waiting && operation==null && guest!=null && maxPoints>0);
        findCustomer.setEnabled(!waiting && operation==null && receiptUuid!=null);
        customerCode.setEnabled(!waiting && operation==null && receiptUuid!=null);
        refresh.setEnabled(!waiting); back.setEnabled(!waiting && operation==null);
        pay.setEnabled(!waiting && operation!=null && ("reserved".equals(operation.phase) || "offered".equals(operation.phase)));
        for (Button button:volumeButtons) button.setEnabled(!waiting && guest!=null && operation==null);
        showVolume();
    }

    private static String liters(int ml) {
        return BigDecimal.valueOf(ml,3).stripTrailingZeros().toPlainString().replace('.',',');
    }

    private void showVolume() {
        volumeStatus.setText("Оплаченный объём: "+liters(beerMl)+" л");
        for (int i=0;i<volumeButtons.size();i++) {
            Button button=volumeButtons.get(i); boolean selected=i*500==beerMl;
            button.setSelected(selected); button.setText((selected ? "✓ " : "")+(i==0 ? "0" : liters(i*500))+" л");
        }
    }

    private void loadVolume(ReceiptBinding active) throws Exception {
        if (active==null) {
            beerMl=0; beerClient=null; beerBoundAt=0; runOnUiThread(this::showVolume); return;
        }
        if (active.userId.equals(beerClient) && active.boundAtMillis==beerBoundAt) return;
        beerMl=0; beerClient=active.userId; beerBoundAt=active.boundAtMillis;
        runOnUiThread(this::showVolume);
        JSONObject answer=PivnikApi.beer(bridge.settings,request("status").put("clientId",active.userId));
        if (!receiptUuid.equals(answer.getString("receiptUuid")) || !active.userId.equals(answer.getString("clientId"))) throw new IllegalStateException("Обновите клиента в этом чеке.");
        if (!answer.isNull("beerMl")) {
            long value=RedemptionOperation.integer(answer,"beerMl");
            if (value>100000 || value%500!=0) throw new IllegalStateException("Некорректный объём.");
            beerMl=(int)value;
        }
        runOnUiThread(this::showVolume);
    }

    private void saveVolume(int selected, ReceiptBinding expected) throws Exception {
        ReceiptBasket before=current();
        ReceiptBinding live=bridge.policy.bindingFor(receiptUuid,System.currentTimeMillis());
        if (live==null || expected==null || !live.userId.equals(expected.userId) || live.boundAtMillis!=expected.boundAtMillis
                || before.hasPayment) throw new IllegalStateException("Клиент или чек изменился. Откройте бонусы снова.");
        JSONObject answer=PivnikApi.beer(bridge.settings,request("save").put("clientId",live.userId).put("beerMl",selected));
        if (!receiptUuid.equals(answer.getString("receiptUuid")) || !live.userId.equals(answer.getString("clientId"))
                || RedemptionOperation.integer(answer,"beerMl")!=selected) throw new IllegalStateException("Нет подтверждения выбранного объёма.");
        ReceiptBasket after=current();
        ReceiptBinding still=bridge.policy.bindingFor(receiptUuid,System.currentTimeMillis());
        if (!after.hash.equals(before.hash) || after.hasPayment || still==null || !still.userId.equals(live.userId)
                || still.boundAtMillis!=live.boundAtMillis) throw new IllegalStateException("Чек изменился. Проверьте клиента и объём заново.");
    }

    private void checkoutOrdinary() {
        if (busy || operation!=null) return;
        if (guest==null) { leaveCheckout(); return; }
        final int selected=beerMl; final ReceiptBinding expected=guest;
        work(() -> {
            saveVolume(selected,expected);
            runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) leaveCheckout(); });
        });
    }

    private interface Work { void run() throws Exception; }
    private void work(Work task) {
        controls(true);
        bridge.worker.execute(() -> {
            try { task.run(); }
            catch (Exception error) { show(error.getMessage()==null ? "Нет подтверждения. Нажмите «Обновить»." : error.getMessage()); }
            finally { runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) controls(false); }); }
        });
    }

    private void show(String text) { runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) status.setText(text); }); }

    private void showCustomer(ReceiptBinding value) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            try {
                current();
                ReceiptBinding live=bridge.policy.bindingFor(receiptUuid,System.currentTimeMillis());
                if (value==null || live==null || !value.userId.equals(live.userId)) {
                    customer.setText("Клиент не выбран"); return;
                }
                String balance=value.unlimitedBonus ? "без лимита" : value.bonusBalance==null ? "недоступен" : value.bonusBalance+" баллов";
                customer.setText(value.displayName+"\nБаланс: "+balance);
            } catch (Exception changed) { customer.setText("Чек изменился. Откройте бонусы в новом чеке."); }
        });
    }

    private void scanCustomer(String raw) {
        if (!foreground || busy || isFinishing() || receiptUuid==null) return;
        if (operation!=null) { scanStatus.setText("Сначала отмените сохранённое списание, затем выбирайте клиента."); return; }
        String payload=PivnikQr.detect(raw);
        if (payload==null) { scanStatus.setText("Нужен QR клиента PIVNIK или короткий код PVK-XXXX-XXXX."); return; }
        customerCode.setText("");
        scanStatus.setText("Определяем клиента и привязываем к этому чеку…");
        controls(true);
        bridge.onPivnikCodeScanned(payload,receiptUuid,message -> {
            if (isFinishing() || isDestroyed()) return;
            controls(false);
            scanStatus.setText(message);
            load();
        });
    }

    @Override protected void onResume() {
        super.onResume(); foreground=true;
        try {
            registerReceiver(scanner,new IntentFilter(ScannerBroadcastReceiver.ACTION_BARCODE_RECEIVED),
                    ScannerBroadcastReceiver.SENDER_PERMISSION,null);
            registered=true;
        } catch (RuntimeException error) { scanStatus.setText("Сканер недоступен. Можно ввести короткий код клиента вручную."); }
        if (!busy) load();
    }

    @Override protected void onPause() {
        foreground=false;
        if (registered) { unregisterReceiver(scanner); registered=false; }
        super.onPause();
    }

    private void load() {
        if (busy) return;
        basket=null; maxPoints=0; guest=null;
        customer.setText("Клиент не выбран"); amount.setText("");
        work(() -> {
            basket=current(); operation=journal.get(receiptUuid);
            guest=bridge.policy.bindingFor(receiptUuid,System.currentTimeMillis());
            showCustomer(guest);
            try { loadVolume(guest); }
            catch (Exception unavailable) {
                beerClient=null; // a later refresh retries; never mistake a failed read for a saved selection.
                runOnUiThread(() -> scanStatus.setText("Объём пока не подтверждён. При переходе к оплате повторим сохранение."));
            }
            if (operation!=null) {
                JSONObject row=PivnikApi.redemption(bridge.settings,request("status")).optJSONObject("redemption");
                if (row!=null && !operation.matchesServer(row)) throw new IllegalStateException("На сервере другая операция. Не применяйте скидку повторно.");
                if (row!=null && "released".equals(row.getString("state")) && basket.documentDiscountCents==0) {
                    journal.clear(receiptUuid); operation=null;
                } else if (row!=null && "committed".equals(row.getString("state"))) {
                    throw new IllegalStateException("Списание уже подтверждено закрытым чеком. Вернитесь к продаже.");
                } else if (row!=null && "review".equals(row.getString("state"))) {
                    throw new IllegalStateException("Закрытый чек требует сверки. Не применяйте списание повторно; обратитесь к разработчику.");
                } else {
                    showOperation(); return;
                }
            }
            if (guest==null) { show("Отсканируйте QR клиента или введите его короткий код в этом окне."); return; }
            if (basket.hasPayment) throw new IllegalStateException("В чеке уже есть оплата. Списание выбирается до начала оплаты.");
            if (basket.foreignLoyalty) throw new IllegalStateException("В чеке уже выбрана другая программа лояльности. Сначала отмените её штатным способом.");
            if (basket.documentDiscountCents!=0) throw new IllegalStateException("В чеке уже есть скидка. Сначала отмените её штатным способом, затем откройте списание.");
            JSONObject answer=PivnikApi.redemption(bridge.settings,quoteRequest("quote",basket,guest.userId));
            if (!guest.userId.equals(answer.getString("clientId")) || RedemptionOperation.integer(answer,"totalCents")!=basket.beforeDocumentDiscountCents
                    || answer.optJSONObject("redemption")!=null) throw new IllegalStateException("Нужно сверить сохранённое списание. Нажмите «Обновить».");
            long balance=RedemptionOperation.integer(answer,"balance"); maxPoints=RedemptionOperation.integer(answer,"maxPoints");
            if (maxPoints>balance || maxPoints>basket.beforeDocumentDiscountCents*30L/10000L) throw new IllegalStateException("Некорректный ответ сервиса.");
            current();
            show("Можно списать: "+maxPoints+" баллов (до 30% чека).\n1 балл = 1 ₽. Остаток — наличными или картой.");
            runOnUiThread(() -> amount.setText(Long.toString(maxPoints)));
        });
    }

    private JSONObject quoteRequest(String action, ReceiptBasket value, String clientId) throws Exception {
        return request(action).put("clientId",clientId).put("totalCents",value.beforeDocumentDiscountCents).put("basketHash",value.hash);
    }

    private void showOperation() {
        show((guest==null ? "Клиент к чеку" : guest.displayName)+"\nК списанию: "+operation.points
            +(basket.ownMarker(operation) && basket.documentDiscountCents==operation.points*100L
                ? "\nСкидка применена. Оплатите остаток наличными или картой."
                : "\nСохранён резерв. Можно применить его к неизменённому чеку или отменить. Баллы повторно не списываются."));
        runOnUiThread(() -> amount.setText(Long.toString(operation.points)));
    }

    private void reserve() {
        if (busy || basket==null) return;
        final String entered=amount.getText().toString().trim();
        work(() -> {
            ReceiptBasket now=current();
            if (now.hasPayment || now.foreignLoyalty || now.documentDiscountCents!=0) throw new IllegalStateException("В чеке уже есть скидка, другая карта или оплата. Сначала проверьте сохранённое списание.");
            RedemptionOperation pending=journal.get(receiptUuid);
            if (pending==null) {
                ReceiptBinding active=bridge.policy.bindingFor(receiptUuid,System.currentTimeMillis());
                if (active==null || guest==null || !active.userId.equals(guest.userId) || !now.hash.equals(basket.hash)) throw new IllegalStateException("Клиент или состав чека изменился. Нажмите «Обновить».");
                if (!entered.matches("[0-9]{1,14}")) throw new IllegalStateException("Введите целое число баллов.");
                long points=Long.parseLong(entered);
                if (points<1 || points>maxPoints) throw new IllegalStateException("Превышен доступный баланс или лимит 30% чека.");
                pending=new RedemptionOperation(UUID.randomUUID().toString(),receiptUuid,guest.userId,now.hash,points,now.beforeDocumentDiscountCents,"requested");
                journal.save(pending); // Never POST before the idempotency key is durable.
            }
            if (!now.matches(pending)) throw new IllegalStateException("Чек изменился. Отмените старый резерв и выберите списание заново.");
            JSONObject body=pending.toJson().put("action","reserve");
            JSONObject row=PivnikApi.redemption(bridge.settings,body).getJSONObject("redemption");
            if (!pending.matchesServer(row) || !"reserved".equals(row.getString("state"))) throw new IllegalStateException("Нет подтверждения резерва. Нажмите «Обновить».");
            operation=pending.phase("reserved"); journal.save(operation);
            ReceiptBasket after=current();
            if (!after.matches(operation) || after.documentDiscountCents!=0) throw new IllegalStateException("Чек изменился во время запроса. Резерв сохранён; отмените его перед новым списанием.");
            showOperation();
            show("Зарезервировано: "+operation.points+" баллов. Нажмите «Оплата» ниже, чтобы применить списание и оплатить остаток.");
        });
    }

    private void payReserved() {
        if (busy || operation==null) return;
        final int selected=beerMl; final ReceiptBinding expected=guest;
        work(() -> {
            RedemptionOperation saved=journal.get(receiptUuid);
            ReceiptBasket after=current();
            if (saved==null || !after.matches(saved)) throw new IllegalStateException("Чек изменился. Проверьте сохранённое списание.");
            saveVolume(selected,expected);
            if (after.ownMarker(saved) && after.documentDiscountCents==saved.points*100L) {
                runOnUiThread(this::leaveCheckout); return;
            }
            if (after.documentDiscountCents!=0) throw new IllegalStateException("В чеке уже есть скидка. Проверьте сохранённое списание.");
            JSONObject confirmed=PivnikApi.redemption(bridge.settings,saved.toJson().put("action","reserve")).getJSONObject("redemption");
            if (!saved.matchesServer(confirmed) || !"reserved".equals(confirmed.getString("state"))) throw new IllegalStateException("Резерв больше не подтверждён. Нажмите «Обновить».");
            JSONObject marker=new JSONObject().put("version",1).put("operationId",saved.operationId).put("points",saved.points);
            after.extras.put("pivnikLoyaltyV1",marker);
            JSONObject data=new JSONObject().put("loyaltyAppId","70110ab9-7265-4a13-8320-fa164642b321")
                .put("loyaltyServicePackage",getPackageName()).put("loyaltyServiceClass",RedemptionService.class.getName()).put("spentBonusAmount",saved.points);
            RedemptionOperation offered=saved.phase("offered"); journal.save(offered);
            finishDiscount(BigDecimal.valueOf(saved.points),after.extras,new AppliedLoyaltyData(saved.clientId,null,data.toString()),offered);
        });
    }

    private void cancel() {
        if (busy || operation==null) return;
        work(() -> {
            RedemptionOperation saved=journal.get(receiptUuid);
            if (saved==null) throw new IllegalStateException("Нажмите «Обновить».");
            ReceiptBasket now=current();
            if (now.hasPayment) throw new IllegalStateException("В чеке уже есть оплата. Завершите или отмените её штатным способом.");
            boolean neverOffered="requested".equals(saved.phase) || "reserved".equals(saved.phase);
            if (now.documentDiscountCents==0 && (neverOffered || now.removedMarker(saved))) {
                JSONObject answer=PivnikApi.redemption(bridge.settings,request("cancel").put("operationId",saved.operationId).put("effectRemoved",true));
                JSONObject row=answer.optJSONObject("redemption");
                boolean cancelledBeforeReserve=row==null && saved.operationId.equals(answer.optString("cancelledOperationId",""));
                if (!cancelledBeforeReserve && (row==null || !saved.matchesServer(row) || !"released".equals(row.getString("state")))) throw new IllegalStateException("Нет подтверждения отмены.");
                journal.clear(receiptUuid); operation=null; basket=null; maxPoints=0;
                show("Списание отменено. Баллы возвращены. Можно вернуться к оплате или нажать «Обновить».");
            } else {
                if (now.foreignLoyalty || (now.documentDiscountCents!=0
                        && (!now.ownMarker(saved) || now.documentDiscountCents!=saved.points*100L))) throw new IllegalStateException("Скидка в чеке изменилась. Удалите её штатным способом, затем нажмите «Обновить» и «Отменить списание».");
                RedemptionOperation removing=saved.phase("removing"); journal.save(removing);
                now.extras.put("pivnikLoyaltyV1",new JSONObject().put("version",1).put("operationId",saved.operationId)
                    .put("points",saved.points).put("removed",true));
                // Release is deliberately AFTER a separate SDK round-trip proves zero discount.
                finishDiscount(BigDecimal.ZERO,now.extras,new AppliedLoyaltyData(null,null,null),removing);
            }
        });
    }

    private void finishDiscount(BigDecimal discount, JSONObject extras, AppliedLoyaltyData loyalty, RedemptionOperation expected) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            try {
                ReceiptBasket live=current();
                if (live.hasPayment || live.foreignLoyalty || !live.uuid.equals(expected.receiptUuid)
                        || (discount.signum()>0 && (!live.matches(expected) || live.documentDiscountCents!=0))
                        || (discount.signum()==0 && live.documentDiscountCents!=0
                            && (!live.ownMarker(expected) || live.documentDiscountCents!=expected.points*100L))) {
                    throw new IllegalStateException("Чек изменился. Резерв сохранён; откройте списание снова.");
                }
                setIntegrationResult(new ReceiptDiscountEventResult(discount,new SetExtra(extras),Collections.emptyList(),null,null,loyalty));
                returningEffect=true;
                finish();
                if (discount.signum()==0) bridge.retryRemovedRedemption(expected.receiptUuid);
            } catch (Exception error) { status.setText(error.getMessage()); }
        });
    }

    private void leaveCheckout() {
        try {
            RedemptionOperation saved=journal.get(receiptUuid);
            ReceiptBasket live=current();
            if (saved!=null && !live.hasPayment && !live.foreignLoyalty && live.documentDiscountCents==0) {
                // A reserve response may have been lost. Leaving to pay full price
                // returns a ZERO SDK effect with our marker, so the authoritative
                // closed receipt can also release the hold if connectivity is lost.
                RedemptionOperation removing=saved.phase("removing"); journal.save(removing);
                live.extras.put("pivnikLoyaltyV1",new JSONObject().put("version",1).put("operationId",saved.operationId)
                    .put("points",saved.points).put("removed",true));
                setIntegrationResult(new ReceiptDiscountEventResult(BigDecimal.ZERO,new SetExtra(live.extras),
                    Collections.emptyList(),null,null,new AppliedLoyaltyData(null,null,null)));
                returningEffect=true;
                finish(); bridge.retryRemovedRedemption(receiptUuid); return;
            }
        } catch (Exception ignored) { /* changed receipt: never write into the next sale */ }
        finish();
    }

    @Override public void onBackPressed() { if (!busy) { if (operation==null) checkoutOrdinary(); else leaveCheckout(); } }

    @Override public void finish() {
        if (!callbackCompleted) {
            callbackCompleted=true;
            if (!returningEffect) IntegrationExit.withoutChanges(getIntent());
        }
        super.finish();
    }
}
