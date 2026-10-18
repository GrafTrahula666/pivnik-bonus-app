package ru.pivnik.evotor;

import android.content.Intent;
import android.os.Bundle;
import ru.evotor.framework.core.IntegrationManager;
import ru.evotor.framework.core.IntegrationResponse;

/** Completes the native integration without replacing discounts, loyalty, positions or payments. */
final class IntegrationExit {
    private IntegrationExit() {}

    static void withoutChanges(Intent intent) {
        Bundle data = intent.getBundleExtra(IntegrationManager.KEY_INTENT_DATA);
        IntegrationResponse response = data == null ? null : data.getParcelable(IntegrationManager.KEY_INTEGRATION_RESPONSE);
        if (response == null) return;
        Bundle result = new Bundle();
        result.putBoolean(IntegrationManager.KEY_SKIP, true);
        response.onResult(result);
    }
}
