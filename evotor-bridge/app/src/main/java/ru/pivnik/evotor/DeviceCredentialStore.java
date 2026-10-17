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
import ru.pivnik.evotor.core.PosConfiguration;

/** Device key encrypted with a non-exportable Android Keystore key. No plaintext fallback. */
final class DeviceCredentialStore {
    private static final String ALIAS = "pivnik_evotor_pos_v1";
    private static final String CIPHER = "device_token_cipher";
    private static final String IV = "device_token_iv";
    private static final String CURRENT_CIPHER = "device_token_v2_cipher";
    private static final String CURRENT_IV = "device_token_v2_iv";
    private final SharedPreferences prefs;
    private final Keys keys;
    private final Encoding encoding;

    interface Keys { SecretKey get(boolean create) throws Exception; }
    interface Encoding {
        String encode(byte[] value);
        byte[] decode(String value);
    }

    DeviceCredentialStore(SharedPreferences prefs) {
        this(prefs, DeviceCredentialStore::key, new Encoding() {
            @Override public String encode(byte[] value) { return Base64.encodeToString(value, Base64.NO_WRAP); }
            @Override public byte[] decode(String value) { return Base64.decode(value, Base64.NO_WRAP); }
        });
    }

    /** Crypto/storage adapters keep the real migration testable without an Android Keystore emulator. */
    DeviceCredentialStore(SharedPreferences prefs, Keys keys, Encoding encoding) {
        this.prefs = prefs;
        this.keys = keys;
        this.encoding = encoding;
    }

    private static SecretKey key(boolean create) throws Exception {
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

    synchronized String read(String origin) {
        try {
            // A present but invalid current record fails closed. Never silently revive
            // an older identity after the owner replaced the credential.
            if (prefs.contains(CURRENT_CIPHER) || prefs.contains(CURRENT_IV)) {
                return decrypt(origin, CURRENT_CIPHER, CURRENT_IV);
            }
            if (!BridgeSettings.DEFAULT_API_BASE.equals(origin)) return "";
            String legacy = decrypt(BridgeSettings.LEGACY_API_BASE, CIPHER, IV);
            if (!PosConfiguration.validToken(legacy)) return "";
            // New slots preserve the exact old encrypted record even if commit fails.
            // It remains available on restart and for an APK rollback, with the same
            // non-exportable Android key. No plaintext preference or log is written.
            try { save(origin, legacy); }
            catch (IllegalStateException error) { /* Retry promotion after restart; old encrypted record is intact. */ }
            return legacy;
        } catch (Exception error) { return ""; }
    }

    private String decrypt(String origin, String cipherKey, String ivKey) throws Exception {
        String ciphertext = prefs.getString(cipherKey, "");
        if (ciphertext.isEmpty()) return "";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, keys.get(false),
                new GCMParameterSpec(128, encoding.decode(prefs.getString(ivKey, ""))));
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        String token = new String(cipher.doFinal(encoding.decode(ciphertext)), StandardCharsets.UTF_8);
        return PosConfiguration.validToken(token) ? token : "";
    }

    synchronized boolean hasStoredCredential() {
        return prefs.contains(CURRENT_CIPHER) || prefs.contains(CURRENT_IV)
                || prefs.contains(CIPHER) || prefs.contains(IV);
    }

    /** An owner-provisioned personal APK can initialize a fresh till, never replace an existing identity. */
    synchronized void seedIfEmpty(String origin, String token) {
        if (!hasStoredCredential()) save(origin, token);
    }

    synchronized void save(String origin, String token) {
        try {
            if (!BridgeSettings.DEFAULT_API_BASE.equals(origin) || !PosConfiguration.validToken(token)) {
                throw new IllegalArgumentException();
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keys.get(true));
            cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            if (!prefs.edit().putString(CURRENT_CIPHER, encoding.encode(encrypted))
                    .putString(CURRENT_IV, encoding.encode(cipher.getIV()))
                    .remove("staff_session_token").commit()) throw new IllegalStateException();
        } catch (Exception error) { throw new IllegalStateException("Could not save device credential"); }
    }
}
