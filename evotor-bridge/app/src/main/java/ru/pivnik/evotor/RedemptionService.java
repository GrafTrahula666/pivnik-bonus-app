package ru.pivnik.evotor;

import android.content.Intent;
import android.os.RemoteException;
import java.util.HashMap;
import java.util.Map;
import ru.evotor.framework.core.IntegrationService;
import ru.evotor.framework.core.action.event.receipt.discount.ReceiptDiscountEvent;
import ru.evotor.framework.core.action.event.receipt.discount.ReceiptDiscountEventProcessor;
import ru.evotor.framework.core.action.event.receipt.before_positions_edited.BeforePositionsEditedEvent;
import ru.evotor.framework.core.action.event.receipt.before_positions_edited.BeforePositionsEditedEventProcessor;
import ru.evotor.framework.core.action.processor.ActionProcessor;

/** Native payment tile plus edit guard while an own-app reservation is unresolved. */
public final class RedemptionService extends IntegrationService {
    @Override protected Map<String,ActionProcessor> createProcessors() {
        Map<String,ActionProcessor> result=new HashMap<>();
        result.put(ReceiptDiscountEvent.NAME_SELL_RECEIPT,new ReceiptDiscountEventProcessor() {
            @Override public void call(String action, ReceiptDiscountEvent event, Callback callback) {
                try { callback.startActivity(new Intent(RedemptionService.this,RedemptionActivity.class)); }
                catch (RemoteException ignored) { /* no wallet or receipt effect has been requested */ }
            }
        });
        result.put(BeforePositionsEditedEvent.NAME_SELL_RECEIPT,new BeforePositionsEditedEventProcessor() {
            @Override public void call(String action, BeforePositionsEditedEvent event, Callback callback) {
                try {
                    if (!event.getChanges().isEmpty() && new RedemptionJournal(RedemptionService.this).get(event.getReceiptUuid())!=null) {
                        callback.onError(409,"Сначала отмените списание PIVNIK на экране оплаты, затем измените товары.");
                    } else callback.skip();
                } catch (RuntimeException | RemoteException ignored) {
                    try { callback.onError(409,"Не удалось сверить сохранённое списание PIVNIK."); } catch (RemoteException ignoredAgain) {}
                }
            }
        });
        return result;
    }
}
