package ru.pivnik.evotor.core;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Bounded optional personal-APK key import; never a staff session or arbitrary asset payload. */
public final class ProvisionedKey {
    private ProvisionedKey() { }

    public static String read(InputStream input) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] chunk = new byte[32];
        int size;
        while ((size = input.read(chunk)) != -1) {
            if (bytes.size() + size > 128) return "";
            bytes.write(chunk, 0, size);
        }
        String token = new String(bytes.toByteArray(), StandardCharsets.UTF_8).trim();
        return PosConfiguration.validToken(token) ? token : "";
    }
}
