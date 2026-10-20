package ru.pivnik.evotor.core;

import static org.junit.Assert.*;
import org.junit.Test;

public class ProxyDiagnosticTest {
    @Test public void unreachableHostDoesNotTellTheOwnerToReinstall() {
        String hint = ProxyDiagnostic.hint("{\"errors\":[{\"code\":2003,\"reason\":\"Destination host unreachable\",\"subject\":\"Read timed out\"}]}");
        assertTrue(hint.contains("не получил ответ сервера"));
        assertTrue(hint.contains("reason/subject"));
        assertFalse(hint.contains("переустанов"));
        assertFalse(hint.contains("включите"));
    }

    @Test public void activationIsDistinguishedFromAnUnknownProxyFailure() {
        String hint = ProxyDiagnostic.hint("{\"errors\":[{\"code\":2003,\"reason\":\"The application is not applied to this device\"}]}");
        assertTrue(hint.contains("не применено"));
        assertFalse(hint.contains("переустанов"));
        assertTrue(ProxyDiagnostic.hint("{\"errors\":[{\"code\":2003,\"reason\":\"Other\"}]}").contains("Ошибка шлюза"));
    }

    @Test public void arbitrary2003TextAndMalformedResponsesDoNotInventAProxyDiagnosis() {
        assertEquals("", ProxyDiagnostic.hint(null));
        assertEquals("", ProxyDiagnostic.hint("<html>2003</html>"));
        assertEquals("", ProxyDiagnostic.hint("{\"error\":\"code 2003\"}"));
        assertEquals("", ProxyDiagnostic.hint("{\"errors\":[null,{\"code\":123,\"reason\":\"Destination host unreachable\"}]}"));
    }
}
