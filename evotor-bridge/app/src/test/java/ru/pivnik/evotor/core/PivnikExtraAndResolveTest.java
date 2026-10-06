package ru.pivnik.evotor.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public class PivnikExtraAndResolveTest {
    @Test
    public void extraCarriesOnlyTheVerifiedUserIdAndVersion() throws Exception {
        JSONObject extra = PivnikExtra.toJson(new ReceiptBinding("r-1", "101", "Кирилл", 1));
        assertEquals(2, extra.length());
        assertEquals("101", extra.getString("pivnik_user_id"));
        assertEquals(1, extra.getInt("pivnik_v"));
        assertFalse("no personal data in the receipt", extra.toString().contains("Кирилл"));
    }

    @Test
    public void closedReceiptVerificationFindsTheIdInNestedOrMergedExtras() {
        assertTrue(PivnikExtra.carriesUser("{\"pivnik_user_id\":\"101\",\"pivnik_v\":1}", "101"));
        assertTrue(PivnikExtra.carriesUser("{\"0f1e-app\":{\"pivnik_user_id\" : \"101\"},\"other\":{\"x\":1}}", "101"));
        assertFalse(PivnikExtra.carriesUser("{\"pivnik_user_id\":\"1012\"}", "101"));
        assertFalse(PivnikExtra.carriesUser("{\"pivnik_user_id\":\"202\"}", "101"));
        assertFalse(PivnikExtra.carriesUser(null, "101"));
        assertFalse(PivnikExtra.carriesUser("", "101"));
    }

    @Test
    public void existingResolveEndpointAnswerIsParsed() {
        ResolveResult result = ResolveResult.fromHttp(200,
                "{\"qrToken\":\"t\",\"shortCode\":\"PVK-AB12-CD34\",\"client\":{\"id\":\"101\",\"firstName\":\"Кирилл\",\"balance\":5}}");
        assertEquals(ResolveResult.Kind.FOUND, result.kind);
        assertEquals("101", result.client.userId);
        assertEquals("Кирилл", result.client.displayName);
        assertEquals("PIVNIK ✓ Кирилл",
                IndicatorText.forBinding(BindingPolicy.Outcome.BOUND, result.client, ""));
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
}
