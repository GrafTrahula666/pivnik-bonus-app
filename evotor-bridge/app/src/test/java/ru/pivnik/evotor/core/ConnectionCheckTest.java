package ru.pivnik.evotor.core;

import static org.junit.Assert.*;
import org.junit.Test;

public class ConnectionCheckTest {
    @Test public void expected401ProvesConnectivityWithoutAKey() {
        assertEquals("NETWORK_OK", ConnectionCheck.classify(false, 401, "{\"error\":\"Требуется ключ кассы.\"}"));
        assertEquals("KEY", ConnectionCheck.classify(true, 401, "{\"error\":\"Ключ кассы недействителен.\"}"));
        assertEquals("KEY", ConnectionCheck.classify(true, 401, "{\"code\":\"unauthorized_pos\"}"));
    }

    @Test public void arbitraryProxyErrorsDoNotProveConnectivityOrRejectTheStoredKey() {
        for (boolean withKey : new boolean[]{false, true}) {
            assertNull(ConnectionCheck.classify(withKey, 401, "{\"errors\":[{\"code\":2003}]}"));
            assertNull(ConnectionCheck.classify(withKey, 401, "<html>Unauthorized</html>"));
            assertNull(ConnectionCheck.classify(withKey, 403, "{\"error\":\"Forbidden\"}"));
            assertNull(ConnectionCheck.classify(withKey, 404, "{\"error\":\"Route not found\"}"));
            assertNull(ConnectionCheck.classify(withKey, 200, "{}"));
            assertNull(ConnectionCheck.classify(withKey, 401, null));
        }
    }

    @Test public void acceptedKeyRequiresTheActualQrNotFoundResponse() {
        String body = "{\"error\":\"QR не найден или отозван.\"}";
        assertEquals("OK", ConnectionCheck.classify(true, 404, body));
        assertNull(ConnectionCheck.classify(false, 404, body));
        assertNull(ConnectionCheck.classify(true, 404, "{\"page\":\"QR не найден\"}"));
    }
}
