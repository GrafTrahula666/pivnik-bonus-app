package ru.pivnik.evotor.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class PivnikQrTest {
    private static final String TOKEN = "Ab3_-xYz0123456789abcdefGHIJKLMN"; // base64url(24 bytes) shape

    @Test
    public void productBarcodesAreNeverClaimed() {
        assertNull(PivnikQr.detect("4601234567890"));          // EAN-13
        assertNull(PivnikQr.detect("46012345"));               // EAN-8
        assertNull(PivnikQr.detect("0104601234567890215abcDEF\u001D93Ab12")); // GS1 DataMatrix (marking)
        assertNull(PivnikQr.detect("https://shop.example/p/12345"));          // product QR
        assertNull(PivnikQr.detect(TOKEN));                    // bare token: server accepts it, the till must not
        assertNull(PivnikQr.detect(""));
        assertNull(PivnikQr.detect(null));
    }

    @Test
    public void officialQrPayloadIsRecognised() {
        assertEquals("PIVNIK:" + TOKEN, PivnikQr.detect("PIVNIK:" + TOKEN));
        assertEquals("PIVNIK:" + TOKEN, PivnikQr.detect("pivnik:" + TOKEN));
        assertEquals("PIVNIK:" + TOKEN, PivnikQr.detect("  ﻿PIVNIK:" + TOKEN + "​\n"));
    }

    @Test
    public void malformedPivnikPayloadsAreNotClaimed() {
        assertNull(PivnikQr.detect("PIVNIK:short"));
        assertNull(PivnikQr.detect("PIVNIK:" + TOKEN + " extra"));
        assertNull(PivnikQr.detect("PIVNIK:" + TOKEN + "?"));
        assertNull(PivnikQr.detect("https://x.example/?payload=PIVNIK:" + TOKEN));
    }

    @Test
    public void printedShortCodeIsRecognised() {
        assertEquals("PVK-AB12-CD34", PivnikQr.detect("PVK-AB12-CD34"));
        assertEquals("PVK-AB12-CD34", PivnikQr.detect("pvk-ab12-cd34"));
        assertNull(PivnikQr.detect("PVK-AB12-CD3"));
        assertNull(PivnikQr.detect("PVKAB12CD34"));
    }
}
