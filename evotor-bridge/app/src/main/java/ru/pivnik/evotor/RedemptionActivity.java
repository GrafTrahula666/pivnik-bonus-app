package ru.pivnik.evotor;

import android.os.Bundle;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
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
import ru.evotor.framework.receipt.AppliedLoyaltyData;
import ru.evotor.framework.receipt.Receipt;
import ru.evotor.framework.receipt.ReceiptApi;
import ru.pivnik.evotor.core.ReceiptBinding;
import ru.pivnik.evotor.core.RedemptionOperation;

/** Explicit cashier-selected native discount tile. Never creates a fictitious payment/product. */
public final class RedemptionActivity extends IntegrationActivity {
    private Bridge bridge;
    private RedemptionJournal journal;
    private String receiptUuid;
    private TextView status;
    private EditText amount;
    private Button apply, remove, refresh, back;
    private boolean busy;
    private ReceiptBasket basket;
    private ReceiptBinding guest;
    private RedemptionOperation operation;
    private long maxPoints;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        bridge=Bridge.get(this); journal=new RedemptionJournal(this);
        ReceiptDiscountEvent event=ReceiptDiscountEvent.create(getSourceBundle());
        receiptUuid=event==null ? null : event.getReceiptUuid();
        int pad=(int)(20*getResources().getDisplayMetrics().density);
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(pad,pad,pad,pad);
        TextView title=new TextView(this); title.setText("PIVNIK · Списать баллы"); title.setTextSize(24); root.addView(title);
        status=new TextView(this); status.setTextSize(20); status.setPadding(0,pad,0,pad); root.addView(status);
        amount=new EditText(this); amount.setInputType(InputType.TYPE_CLASS_NUMBER); amount.setHint("Сколько баллов списать"); root.addView(amount);
        apply=new Button(this); apply.setText("Списать баллы"); apply.setOnClickListener(v -> reserve()); root.addView(apply);
        remove=new Button(this); remove.setText("Отменить списание"); remove.setOnClickListener(v -> cancel()); root.addView(remove);
        refresh=new Button(this); refresh.setText("Обновить"); refresh.setOnClickListener(v -> load()); root.addView(refresh);
        back=new Button(this); back.setText("Вернуться к оплате"); back.setOnClickListener(v -> { if (!busy) leaveCheckout(); }); root.addView(back);
        ScrollView scroll=new ScrollView(this); scroll.addView(root); setContentView(scroll);
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
        remove.setEnabled(!waiting && operation!=null); amount.setEnabled(!waiting && operation==null);
        refresh.setEnabled(!waiting); back.setEnabled(!waiting);
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

    private void load() {
        if (busy) return;
        basket=null; maxPoints=0;
        work(() -> {
            basket=current(); operation=journal.get(receiptUuid);
            guest=bridge.policy.bindingFor(receiptUuid,System.currentTimeMillis());
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
            if (guest==null) throw new IllegalStateException("Клиент к этому чеку не прикреплён. Вернитесь в продажу и отсканируйте QR клиента.");
            if (basket.hasPayment) throw new IllegalStateException("В чеке уже есть оплата. Списание выбирается до начала оплаты.");
            if (basket.foreignLoyalty) throw new IllegalStateException("В чеке уже выбрана другая программа лояльности. Сначала отмените её штатным способом.");
            if (basket.documentDiscountCents!=0) throw new IllegalStateException("В чеке уже есть скидка. Сначала отмените её штатным способом, затем откройте списание.");
            JSONObject answer=PivnikApi.redemption(bridge.settings,quoteRequest("quote",basket,guest.userId));
            if (!guest.userId.equals(answer.getString("clientId")) || RedemptionOperation.integer(answer,"totalCents")!=basket.beforeDocumentDiscountCents
                    || answer.optJSONObject("redemption")!=null) throw new IllegalStateException("Нужно сверить сохранённое списание. Нажмите «Обновить».");
            long balance=RedemptionOperation.integer(answer,"balance"); maxPoints=RedemptionOperation.integer(answer,"maxPoints");
            if (maxPoints>balance || maxPoints>basket.beforeDocumentDiscountCents*30L/10000L) throw new IllegalStateException("Некорректный ответ сервиса.");
            current();
            show(guest.displayName+"\nБаланс: "+balance+" баллов\nМожно списать: "+maxPoints+" (до 30% чека).\n1 балл = 1 ₽. Остаток — наличными или картой.");
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
            JSONObject marker=new JSONObject().put("version",1).put("operationId",operation.operationId).put("points",operation.points);
            after.extras.put("pivnikLoyaltyV1",marker);
            JSONObject data=new JSONObject().put("loyaltyAppId","70110ab9-7265-4a13-8320-fa164642b321")
                .put("loyaltyServicePackage",getPackageName()).put("loyaltyServiceClass",RedemptionService.class.getName()).put("spentBonusAmount",operation.points);
            RedemptionOperation offered=operation.phase("offered"); journal.save(offered);
            finishDiscount(BigDecimal.valueOf(operation.points),after.extras,new AppliedLoyaltyData(operation.clientId,null,data.toString()),offered);
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
                finish(); bridge.retryRemovedRedemption(receiptUuid); return;
            }
        } catch (Exception ignored) { /* changed receipt: never write into the next sale */ }
        finish();
    }

    @Override public void onBackPressed() { if (!busy) leaveCheckout(); }
}
