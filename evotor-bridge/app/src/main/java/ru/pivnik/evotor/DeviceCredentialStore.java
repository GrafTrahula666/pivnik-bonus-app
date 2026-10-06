package ru.pivnik.evotor;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Device key encrypted with a non-exportable Android Keystore key. No plaintext fallback. */
final class DeviceCredentialStore {
    private static final String ALIAS = "pivnik_evotor_pos_v1";
    private static final String CIPHER = "device_token_cipher";
    private static final String IV = "device_token_iv";
    private final SharedPreferences prefs;

    DeviceCredentialStore(SharedPreferences prefs) { this.prefs = prefs; }

    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create) throw new IllegalStateException("Device credential unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    String read(String origin) {
        try {
            String ciphertext = prefs.getString(CIPHER, "");
            if (ciphertext.isEmpty()) return "";
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false),
                    new GCMParameterSpec(128, Base64.decode(prefs.getString(IV, ""), Base64.NO_WRAP)));
            cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception error) { return ""; }
    }

    void save(String origin, String token) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
            cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            if (!prefs.edit().putString("api_base_url", origin)
                    .putString(CIPHER, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .remove("staff_session_token").commit()) throw new IllegalStateException();
        } catch (Exception error) { throw new IllegalStateException("Could not save device credential"); }
    }
}
