package ru.pivnik.evotor.core;

import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class ProvisionedKeyTest {
    private static final String TOKEN = "pvpos_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

    private String read(String value) throws Exception {
        return ProvisionedKey.read(new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8)));
    }

    @Test public void acceptsOnlyOneCompletePosCredential() throws Exception {
        assertEquals(TOKEN, read(TOKEN + "\n"));
        for (String value : new String[]{"", "staff_session", "Device " + TOKEN,
                TOKEN + "\n" + TOKEN, TOKEN + "X", TOKEN.substring(0, 48)}) assertEquals("", read(value));
    }

    @Test public void fragmentedAssetReadsStillImportTheCompleteKey() throws Exception {
        ByteArrayInputStream input = new ByteArrayInputStream(TOKEN.getBytes(StandardCharsets.UTF_8)) {
            @Override public synchronized int read(byte[] bytes, int offset, int length) {
                return super.read(bytes, offset, Math.min(length, 3));
            }
        };
        assertEquals(TOKEN, ProvisionedKey.read(input));
    }

    @Test public void oversizedOrNonAsciiProvisioningIsRejected() throws Exception {
        assertEquals("", read(new String(new char[512]).replace('\0', 'A')));
        assertEquals("", read(TOKEN.replace('A', 'А')));
    }
}
