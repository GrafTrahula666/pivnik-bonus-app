package ru.pivnik.evotor;

import android.app.Application;
import android.content.Intent;
import android.os.Bundle;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowApplication;
import ru.evotor.framework.core.IIntegrationManagerResponse;
import ru.evotor.framework.core.IntegrationManager;
import ru.evotor.framework.core.IntegrationResponse;
import ru.evotor.framework.core.action.event.receipt.discount.ReceiptDiscountEvent;
import ru.evotor.framework.device.scanner.event.BarcodeReceivedEvent;
import ru.evotor.framework.device.scanner.event.handler.receiver.ScannerBroadcastReceiver;
import ru.evotor.framework.receipt.event.ReceiptCompletedEvent;
import ru.evotor.framework.receipt.event.ReceiptCreatedEvent;
import ru.evotor.framework.receipt.event.ReceiptDeletedEvent;
import ru.evotor.framework.receipt.event.handler.receiver.SellReceiptBroadcastReceiver;
import ru.pivnik.evotor.core.ResolvedClient;
import static org.junit.Assert.*;

/** Actual SDK callbacks/lifecycle and Android views, with no network or monetary fixture writes. */
@RunWith(RobolectricTestRunner.class)
@Config(manifest=Config.NONE,sdk=28)
public final class BonusWindowTest {
    private static final String A="11111111-aaaa-4aaa-8aaa-111111111111";
    private static final String B="22222222-bbbb-4bbb-8bbb-222222222222";
    private final List<Bundle> replies=new ArrayList<>();
    private ActivityController<RedemptionActivity> controller;

    private Intent request() {
        Application app=RuntimeEnvironment.getApplication();
        Bundle data=new Bundle();
        data.putParcelable(IntegrationManager.KEY_SOURCE_DATA,new ReceiptDiscountEvent(A,BigDecimal.TEN).toBundle());
        data.putParcelable(IntegrationManager.KEY_INTEGRATION_RESPONSE,new IntegrationResponse(new IIntegrationManagerResponse.Stub() {
            @Override public void onResult(Bundle result) { replies.add(result); }
            @Override public void onError(int code,String message,Bundle data) { fail(message); }
        }));
        return new Intent(app,RedemptionActivity.class).putExtra(IntegrationManager.KEY_INTENT_DATA,data);
    }

    private RedemptionActivity open() throws Exception {
        controller=Robolectric.buildActivity(RedemptionActivity.class,request()).create().start().resume();
        settle();
        return controller.get();
    }

    private void settle() throws Exception {
        Bridge.get(RuntimeEnvironment.getApplication()).worker.submit(() -> {}).get(10,TimeUnit.SECONDS);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
    }

    @After public void clean() throws Exception {
        if (controller!=null) controller.pause().stop().destroy();
        Field field=Bridge.class.getDeclaredField("instance"); field.setAccessible(true);
        Bridge bridge=(Bridge)field.get(null);
        if (bridge!=null) { bridge.worker.shutdownNow(); bridge.recoveryWorker.shutdownNow(); }
        field.set(null,null);
    }

    @Test public void returnToPaymentCompletesOnceWithoutRemovingExistingDiscountOrCustomer() throws Exception {
        Bridge bridge=Bridge.get(RuntimeEnvironment.getApplication());
        bridge.policy.onCustomerResolved(A,A,new ResolvedClient("101","Гость",90L,false),System.currentTimeMillis());
        RedemptionActivity activity=open();
        button(activity.getWindow().getDecorView(),"Перейти к оплате").performClick();
        activity.finish();
        assertEquals(1,replies.size());
        Bundle reply=replies.get(0);
        assertTrue(reply.getBoolean(IntegrationManager.KEY_SKIP));
        assertFalse(reply.containsKey(IntegrationManager.KEY_DATA));
        assertFalse(reply.containsKey("discount"));
        assertEquals("101",bridge.policy.bindingFor(A,System.currentTimeMillis()).userId);
        assertNull(bridge.policy.bindingFor(B,System.currentTimeMillis()));
    }

    @Test public void androidBackAlsoCompletesWithoutReceiptChanges() throws Exception {
        RedemptionActivity activity=open();
        activity.onBackPressed();
        assertEquals(1,replies.size());
        assertTrue(replies.get(0).getBoolean(IntegrationManager.KEY_SKIP));
        assertFalse(replies.get(0).containsKey(IntegrationManager.KEY_DATA));
    }

    @Test public void scannerIsPermissionRestrictedAndRegisteredOnlyWhileWindowIsResumed() throws Exception {
        RedemptionActivity activity=open();
        ShadowApplication app=Shadows.shadowOf(RuntimeEnvironment.getApplication());
        List<ShadowApplication.Wrapper> receivers=new ArrayList<>();
        for (ShadowApplication.Wrapper item:app.getRegisteredReceivers())
            if (item.broadcastReceiver instanceof ScannerBroadcastReceiver) receivers.add(item);
        assertEquals(1,receivers.size());
        assertEquals(ScannerBroadcastReceiver.SENDER_PERMISSION,receivers.get(0).broadcastPermission);
        Intent product=new Intent(ScannerBroadcastReceiver.ACTION_BARCODE_RECEIVED).putExtras(new BarcodeReceivedEvent("4601234567890").toBundle());
        receivers.get(0).broadcastReceiver.onReceive(activity,product);
        assertTrue(allText(activity.getWindow().getDecorView()).contains("Нужен QR клиента"));
        controller.pause();
        assertTrue(app.getReceiversForIntent(product).isEmpty());
        controller.resume(); settle();
        assertEquals(1,app.getReceiversForIntent(product).size());
    }

    @Test public void manualEntryUsesTheSameCustomerCodeValidation() throws Exception {
        RedemptionActivity activity=open();
        EditText field=edit(activity.getWindow().getDecorView(),"Код клиента PVK-XXXX-XXXX или QR-код");
        assertNotNull(field); field.setText("4601234567890");
        button(activity.getWindow().getDecorView(),"Найти клиента").performClick();
        assertTrue(allText(activity.getWindow().getDecorView()).contains("Нужен QR клиента"));
        assertTrue(replies.isEmpty());
    }

    @Test @Config(sdk={23,28})
    public void windowStartsWithoutEditableFocusAndManualCodeRemainsAvailable() throws Exception {
        RedemptionActivity activity=open();
        controller.visible(); settle();
        int mode=activity.getWindow().getAttributes().softInputMode;
        assertEquals(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN,
                mode & WindowManager.LayoutParams.SOFT_INPUT_MASK_STATE);
        assertEquals(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
                mode & WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST);
        assertFalse(activity.getCurrentFocus() instanceof EditText);
        EditText code=edit(activity.getWindow().getDecorView(),"Код клиента PVK-XXXX-XXXX или QR-код");
        EditText points=edit(activity.getWindow().getDecorView(),"Сколько баллов списать");
        assertFalse(code.hasFocus());
        assertFalse(points.hasFocus());
        assertTrue(code.isEnabled());
        assertTrue(code.requestFocus());
        assertTrue(code.hasFocus());
        code.setText("PVK-AAAA-2222");
        assertEquals("PVK-AAAA-2222",code.getText().toString());
        assertTrue(replies.isEmpty());
    }

    @Test public void actualSdkCloseClearAndNewReceiptEventsRemoveIdentityAndInvalidateLateResponse() {
        Application app=RuntimeEnvironment.getApplication(); Bridge bridge=Bridge.get(app);
        PivnikReceiptReceiver receiver=new PivnikReceiptReceiver();
        for (String action:new String[]{SellReceiptBroadcastReceiver.ACTION_RECEIPT_COMPLETED,SellReceiptBroadcastReceiver.ACTION_RECEIPT_DELETED}) {
            bridge.policy.onCustomerResolved(A,A,new ResolvedClient("101","Первый гость"),System.currentTimeMillis());
            ru.pivnik.evotor.core.BindingPolicy.ScanTicket late=bridge.policy.beginScan(A);
            Bundle event=action.equals(SellReceiptBroadcastReceiver.ACTION_RECEIPT_COMPLETED)
                    ? new ReceiptCompletedEvent(A).toBundle() : new ReceiptDeletedEvent(A).toBundle();
            receiver.onReceive(app,new Intent(action).putExtras(event));
            receiver.onReceive(app,new Intent(SellReceiptBroadcastReceiver.ACTION_RECEIPT_CREATED).putExtras(new ReceiptCreatedEvent(B).toBundle()));
            assertNull(bridge.policy.storedBinding());
            assertNull(bridge.policy.bindingFor(B,System.currentTimeMillis()));
            assertFalse(bridge.policy.isScanCurrent(late)); bridge.policy.endScan(late);
        }
    }

    @Test public void volumeButtonsSelectTheTotalRatherThanAddingAndZeroClearsIt() throws Exception {
        RedemptionActivity activity=open();
        Field guest=RedemptionActivity.class.getDeclaredField("guest"); guest.setAccessible(true);
        guest.set(activity,new ru.pivnik.evotor.core.ReceiptBinding(A,"101","Гость",System.currentTimeMillis()));
        java.lang.reflect.Method controls=RedemptionActivity.class.getDeclaredMethod("controls",boolean.class); controls.setAccessible(true); controls.invoke(activity,false);
        View root=activity.getWindow().getDecorView();
        Button half=button(root,"0,5 л"); assertNotNull(half); assertTrue(half.isEnabled()); half.performClick();
        assertTrue(allText(root).contains("Оплаченный объём: 0,5 л"));
        button(root,"1,5 л").performClick();
        assertTrue(allText(root).contains("Оплаченный объём: 1,5 л"));
        button(root,"✓ 1,5 л").performClick();
        assertTrue(allText(root).contains("Оплаченный объём: 1,5 л"));
        button(root,"0 л").performClick();
        assertTrue(allText(root).contains("Оплаченный объём: 0 л"));
        assertTrue(replies.isEmpty());
    }

    @Test public void ordinaryCheckoutAndRedemptionHaveSeparateButtonsAndVolumeNeedsACustomer() throws Exception {
        RedemptionActivity activity=open(); View root=activity.getWindow().getDecorView();
        assertNotNull(button(root,"Перейти к оплате"));
        assertFalse(button(root,"Оплата").isEnabled());
        assertFalse(button(root,"0,5 л").isEnabled());
        assertTrue(allText(root).contains("Списание баллов"));
        assertTrue(allText(root).contains("Отсканируйте QR-код клиента"));
    }

    private static Button button(View view,String text) {
        if (view instanceof Button && text.contentEquals(((Button)view).getText())) return (Button)view;
        if (view instanceof ViewGroup) for (int i=0;i<((ViewGroup)view).getChildCount();i++) {
            Button found=button(((ViewGroup)view).getChildAt(i),text); if (found!=null) return found;
        }
        return null;
    }
    private static EditText edit(View view,String hint) {
        if (view instanceof EditText && hint.contentEquals(((EditText)view).getHint())) return (EditText)view;
        if (view instanceof ViewGroup) for (int i=0;i<((ViewGroup)view).getChildCount();i++) {
            EditText found=edit(((ViewGroup)view).getChildAt(i),hint); if (found!=null) return found;
        }
        return null;
    }
    private static String allText(View view) {
        StringBuilder result=new StringBuilder();
        if (view instanceof TextView) result.append(((TextView)view).getText()).append('\n');
        if (view instanceof ViewGroup) for (int i=0;i<((ViewGroup)view).getChildCount();i++) result.append(allText(((ViewGroup)view).getChildAt(i)));
        return result.toString();
    }
}
