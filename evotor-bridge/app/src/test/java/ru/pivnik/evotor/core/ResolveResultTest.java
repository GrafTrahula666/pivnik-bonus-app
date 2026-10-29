package ru.pivnik.evotor.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ResolveResultTest {
    @Test
    public void existingResolveEndpointAnswerIsParsed() {
        ResolveResult result = ResolveResult.fromHttp(200,
                "{\"qrToken\":\"t\",\"shortCode\":\"PVK-AB12-CD34\",\"client\":{\"id\":\"101\",\"firstName\":\"Кирилл\",\"balance\":5}}");
        assertEquals(ResolveResult.Kind.FOUND, result.kind);
        assertEquals("101", result.client.userId);
        assertEquals("Кирилл", result.client.displayName);
        assertNull(result.client.bonusBalance);
        assertEquals("PIVNIK ✓ Кирилл • баланс недоступен",
                IndicatorText.forBinding(BindingPolicy.Outcome.BOUND, result.client, ""));
    }

    @Test
    public void walletSnapshotIsSeparateFromIdentityAndNeverAuthorizesSpending() {
        ResolveResult result = ResolveResult.fromHttp(200,
                "{\"client\":{\"id\":\"101\",\"firstName\":\"Кирилл\"},\"wallet\":{\"balance\":123,\"unlimited\":false}}");
        assertEquals(ResolveResult.Kind.FOUND, result.kind);
        assertEquals(Long.valueOf(123), result.client.bonusBalance);
        assertEquals("PIVNIK ✓ Кирилл • баллы: 123", IndicatorText.forBinding(BindingPolicy.Outcome.BOUND, result.client, ""));
        for (String wallet : new String[] {"null", "{}", "{\"balance\":-1,\"unlimited\":false}",
                "{\"balance\":1.5,\"unlimited\":false}", "{\"balance\":9007199254740992,\"unlimited\":false}",
                "{\"balance\":123,\"unlimited\":\"false\"}"}) {
            assertEquals(ResolveResult.Kind.UNAVAILABLE, ResolveResult.fromHttp(200,
                    "{\"client\":{\"id\":\"101\"},\"wallet\":" + wallet + "}").kind);
        }
    }

    @Test
    public void numericJsonIdIsAccepted() {
        assertEquals("7", ResolveResult.fromHttp(200, "{\"client\":{\"id\":7,\"firstName\":\"A\"}}").client.userId);
    }

    @Test
    public void everyFailureKeepsTheSaleWithoutPivnik() {
        assertEquals(ResolveResult.Kind.NOT_FOUND, ResolveResult.fromHttp(404, "{\"error\":\"Персональный код не найден.\"}").kind);
        assertEquals(ResolveResult.Kind.UNAUTHORIZED, ResolveResult.fromHttp(401, "{}").kind);
        assertEquals(ResolveResult.Kind.UNAUTHORIZED, ResolveResult.fromHttp(403, "{}").kind);
        assertEquals(ResolveResult.Kind.UNAUTHORIZED, ResolveResult.fromHttp(428, "{}").kind);
        assertEquals(ResolveResult.Kind.RATE_LIMITED, ResolveResult.fromHttp(429, "{}").kind);
        assertEquals(ResolveResult.Kind.CONFLICT, ResolveResult.fromHttp(409, "{}").kind);
        assertEquals(ResolveResult.Kind.UNAVAILABLE, ResolveResult.fromHttp(502, "<html>").kind);
        assertEquals(ResolveResult.Kind.UNAVAILABLE, ResolveResult.fromHttp(200, "not json").kind);
        assertEquals(ResolveResult.Kind.UNAVAILABLE, ResolveResult.fromHttp(200, "{\"client\":null}").kind);
        assertEquals(ResolveResult.Kind.UNAVAILABLE, ResolveResult.fromHttp(200, "{\"client\":{\"id\":\"PIVNIK:x\"}}").kind);
        assertEquals(ResolveResult.Kind.UNAVAILABLE, ResolveResult.fromHttp(200, null).kind);
        assertNull(ResolveResult.unavailable().client);
    }

    @Test
    public void replacementPromptNamesTheCurrentCustomer() {
        String text = IndicatorText.forBinding(BindingPolicy.Outcome.REPLACE_NEEDS_CONFIRMATION,
                new ResolvedClient("202", "Анна"), "Кирилл");
        assertTrue(text.contains("Кирилл"));
        assertTrue(text.contains("ещё раз"));
    }

    @Test
    public void failedBindAsksForAnotherScanUnlessTheReceiptIsSettled() {
        assertTrue(IndicatorText.bindFailed(ResolveResult.Kind.UNAVAILABLE).contains("ещё раз"));
        assertTrue(IndicatorText.bindFailed(ResolveResult.Kind.CONFLICT).contains("другому клиенту"));
    }
}
