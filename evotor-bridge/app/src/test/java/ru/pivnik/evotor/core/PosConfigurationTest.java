package ru.pivnik.evotor.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;
import org.junit.Test;

public class PosConfigurationTest {
    @Test public void deviceCredentialCannotBeAStaffSession() {
        assertTrue(PosConfiguration.validToken("pvpos_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"));
        assertFalse(PosConfiguration.validToken("eyJhbGciOiJIUzI1NiJ9.staff.session"));
        assertFalse(PosConfiguration.validToken(null));
    }
    @Test public void httpsBaseHasNoCredentialsQueryOrFragment() {
        assertTrue(PosConfiguration.validBase("https://example.invalid"));
        assertFalse(PosConfiguration.validBase("http://example.invalid"));
        assertFalse(PosConfiguration.validBase("https://user:password@example.invalid"));
        assertFalse(PosConfiguration.validBase("https://example.invalid?token=secret"));
        assertFalse(PosConfiguration.validBase("https://example.invalid#token"));
    }
    @Test public void typedOrScannedKeyIsCleaned() {
        String key = "pvpos_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
        assertEquals(key, PosConfiguration.cleanToken(" pvpos_abcdefghijklmnopqrstuvw xyzABCDEFGHIJKLMNOPQ\n"));
        assertEquals(key, PosConfiguration.cleanToken("Device " + key));
        assertEquals("", PosConfiguration.cleanToken(null));
        assertEquals("Devicex", PosConfiguration.cleanToken("Device x"));
    }
}
