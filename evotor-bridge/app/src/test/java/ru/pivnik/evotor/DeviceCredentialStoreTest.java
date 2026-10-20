package ru.pivnik.evotor;

import static org.junit.Assert.*;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.junit.Before;
import org.junit.Test;

/** Actual store and AES-GCM on JVM; only Android key access/Base64 and preference I/O are adapters. */
public class DeviceCredentialStoreTest {
    private static final String OLD = BridgeSettings.LEGACY_API_BASE;
    private static final String CURRENT = BridgeSettings.DEFAULT_API_BASE;
    private static final String TOKEN = "pvpos_" + repeat('A', 43);
    private static final String REPLACEMENT = "pvpos_" + repeat('B', 43);
    private SecretKey key;
    private Prefs prefs;
    private int keyCreates;
    private DeviceCredentialStore store;
    private final DeviceCredentialStore.Encoding encoding = new DeviceCredentialStore.Encoding() {
        @Override public String encode(byte[] value) { return Base64.getEncoder().encodeToString(value); }
        @Override public byte[] decode(String value) { return Base64.getDecoder().decode(value); }
    };

    @Before public void setup() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(128);
        key = generator.generateKey();
        prefs = new Prefs();
        store = create(prefs);
    }

    private DeviceCredentialStore create(Prefs target) {
        return new DeviceCredentialStore(target, create -> { if (create) keyCreates++; return key; }, encoding);
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < count; i++) result.append(value);
        return result.toString();
    }

    private void legacy(String origin, String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        prefs.edit().putString("device_token_cipher", encoding.encode(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8))))
                .putString("device_token_iv", encoding.encode(cipher.getIV())).putString("api_base_url", origin).commit();
    }

    private String decryptRecord(String cipherName, String ivName, String origin) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, encoding.decode(prefs.getString(ivName, ""))));
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(encoding.decode(prefs.getString(cipherName, ""))), StandardCharsets.UTF_8);
    }

    @Test public void existingCredentialSurvivesExactOriginChangeAndRetainsRollbackRecord() throws Exception {
        legacy(OLD, TOKEN);
        Map<String, String> original = new HashMap<>(prefs.disk);
        assertEquals(TOKEN, store.read(CURRENT));
        for (String field : original.keySet()) assertEquals(original.get(field), prefs.disk.get(field));
        assertEquals(TOKEN, decryptRecord("device_token_v2_cipher", "device_token_v2_iv", CURRENT));
        assertEquals(TOKEN, decryptRecord("device_token_cipher", "device_token_iv", OLD));
        for (String value : prefs.disk.values()) assertFalse(value.contains(TOKEN));
    }

    @Test public void migrationIsOneTimeAndWorksAfterProcessRestart() throws Exception {
        legacy(OLD, TOKEN);
        assertEquals(TOKEN, store.read(CURRENT));
        String encrypted = prefs.getString("device_token_v2_cipher", "");
        int writes = prefs.commits;
        assertEquals(TOKEN, create(prefs.restart()).read(CURRENT));
        assertEquals(TOKEN, store.read(CURRENT));
        assertEquals(writes, prefs.commits);
        assertEquals(encrypted, prefs.getString("device_token_v2_cipher", ""));
    }

    @Test public void failedPromotionKeepsThePersistedOldCredentialRecoverable() throws Exception {
        legacy(OLD, TOKEN);
        Map<String, String> original = new HashMap<>(prefs.disk);
        prefs.failCommit = true;
        assertEquals(TOKEN, store.read(CURRENT));
        assertEquals(original, prefs.disk);
        Prefs restarted = prefs.restart();
        assertEquals(TOKEN, create(restarted).read(CURRENT));
        assertTrue(restarted.disk.containsKey("device_token_v2_cipher"));
    }

    @Test public void onlyTheExplicitPreviousProductionBaseCanBeMigrated() throws Exception {
        legacy("https://other.invalid", TOKEN);
        assertEquals("", store.read(CURRENT));
        assertFalse(prefs.contains("device_token_v2_cipher"));
        legacy(OLD, TOKEN);
        assertEquals("", store.read("https://other.invalid"));
        assertEquals("", store.read(CURRENT + "/"));
        assertEquals("", store.read(OLD));
        assertEquals(0, keyCreates);
    }

    @Test public void currentReplacementWinsOverTheRetainedLegacyIdentity() throws Exception {
        legacy(OLD, TOKEN);
        assertEquals(TOKEN, store.read(CURRENT));
        store.save(CURRENT, REPLACEMENT);
        assertEquals(REPLACEMENT, store.read(CURRENT));
        assertEquals(REPLACEMENT, create(prefs.restart()).read(CURRENT));
        assertEquals("", store.read(OLD));
    }

    @Test public void corruptedCurrentRecordDoesNotSilentlyReviveAnOldKey() throws Exception {
        legacy(OLD, TOKEN);
        store.save(CURRENT, REPLACEMENT);
        prefs.edit().putString("device_token_v2_cipher", "corrupt").commit();
        int writes = prefs.commits;
        assertEquals("", store.read(CURRENT));
        assertEquals(writes, prefs.commits);
        assertEquals("corrupt", prefs.getString("device_token_v2_cipher", ""));
    }

    @Test public void incompleteCurrentRecordFailsClosed() throws Exception {
        legacy(OLD, TOKEN);
        prefs.edit().putString("device_token_v2_iv", "incomplete").commit();
        assertEquals("", store.read(CURRENT));
        assertFalse(prefs.contains("device_token_v2_cipher"));
    }

    @Test public void aStaffSessionOrUnreadableLegacyCipherIsNeverPromoted() throws Exception {
        legacy(OLD, "staff_session_fixture");
        assertEquals("", store.read(CURRENT));
        assertFalse(prefs.contains("device_token_v2_cipher"));
        prefs.edit().putString("device_token_cipher", "broken").commit();
        assertEquals("", store.read(CURRENT));
        assertEquals(0, keyCreates);
    }

    @Test public void unavailableKeystoreDoesNotClearEncryptedDataOrGenerateAReplacement() throws Exception {
        legacy(OLD, TOKEN);
        Map<String, String> original = new HashMap<>(prefs.disk);
        DeviceCredentialStore unavailable = new DeviceCredentialStore(prefs, create -> {
            assertFalse(create);
            throw new IllegalStateException();
        }, encoding);
        assertEquals("", unavailable.read(CURRENT));
        assertEquals(original, prefs.disk);
    }

    @Test public void wrongBaseCannotDecryptOrSaveTheCurrentCredential() throws Exception {
        store.save(CURRENT, TOKEN);
        assertEquals("", store.read("https://other.invalid"));
        try {
            store.save("https://other.invalid", REPLACEMENT);
            fail("Foreign base accepted");
        } catch (IllegalStateException expected) { }
        assertEquals(TOKEN, store.read(CURRENT));
    }

    @Test public void personalProvisioningInitializesOnlyAnEmptyStore() throws Exception {
        store.seedIfEmpty(CURRENT, TOKEN);
        assertEquals(TOKEN, store.read(CURRENT));
        store.seedIfEmpty(CURRENT, REPLACEMENT);
        assertEquals(TOKEN, store.read(CURRENT));
        for (String value : prefs.disk.values()) assertFalse(value.contains(TOKEN));
    }

    @Test public void personalProvisioningNeverOverridesAnExistingOrDamagedLegacyRecord() throws Exception {
        legacy(OLD, TOKEN);
        store.seedIfEmpty(CURRENT, REPLACEMENT);
        assertEquals(TOKEN, store.read(CURRENT));
        prefs = new Prefs(); store = create(prefs);
        prefs.edit().putString("device_token_cipher", "damaged").commit();
        store.seedIfEmpty(CURRENT, REPLACEMENT);
        assertEquals("", store.read(CURRENT));
        assertFalse(prefs.contains("device_token_v2_cipher"));
    }

    /** Models Android's in-memory edit even when the durable commit returns false. */
    private static final class Prefs implements SharedPreferences {
        final Map<String, String> memory = new HashMap<>();
        final Map<String, String> disk = new HashMap<>();
        int commits;
        boolean failCommit;
        Prefs restart() { Prefs next = new Prefs(); next.disk.putAll(disk); next.memory.putAll(disk); return next; }
        @Override public Map<String, ?> getAll() { return new HashMap<>(memory); }
        @Override public String getString(String key, String fallback) { return memory.containsKey(key) ? memory.get(key) : fallback; }
        @Override public Set<String> getStringSet(String key, Set<String> fallback) { throw new UnsupportedOperationException(); }
        @Override public int getInt(String key, int fallback) { throw new UnsupportedOperationException(); }
        @Override public long getLong(String key, long fallback) { throw new UnsupportedOperationException(); }
        @Override public float getFloat(String key, float fallback) { throw new UnsupportedOperationException(); }
        @Override public boolean getBoolean(String key, boolean fallback) { throw new UnsupportedOperationException(); }
        @Override public boolean contains(String key) { return memory.containsKey(key); }
        @Override public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) { }
        @Override public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) { }
        @Override public Editor edit() { return new Editor() {
            final Map<String, String> updates = new HashMap<>();
            final Set<String> removals = new HashSet<>();
            boolean clear;
            @Override public Editor putString(String key, String value) { updates.put(key, value); return this; }
            @Override public Editor remove(String key) { removals.add(key); return this; }
            @Override public Editor clear() { clear = true; return this; }
            @Override public boolean commit() {
                commits++;
                if (clear) memory.clear();
                for (String key : removals) memory.remove(key);
                memory.putAll(updates);
                if (failCommit) return false;
                disk.clear(); disk.putAll(memory); return true;
            }
            @Override public void apply() { commit(); }
            @Override public Editor putStringSet(String key, Set<String> value) { throw new UnsupportedOperationException(); }
            @Override public Editor putInt(String key, int value) { throw new UnsupportedOperationException(); }
            @Override public Editor putLong(String key, long value) { throw new UnsupportedOperationException(); }
            @Override public Editor putFloat(String key, float value) { throw new UnsupportedOperationException(); }
            @Override public Editor putBoolean(String key, boolean value) { throw new UnsupportedOperationException(); }
        }; }
    }
}
