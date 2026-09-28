package ru.pivnik.kiosk;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import java.util.ArrayList;
import java.util.List;

public final class KioskController {
    private KioskController() {}
    public static ComponentName admin(Context c) { return new ComponentName(c, PivnikDeviceAdminReceiver.class); }
    public static DevicePolicyManager dpm(Context c) { return (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE); }
    public static boolean isDeviceOwner(Context c) { return dpm(c).isDeviceOwnerApp(c.getPackageName()); }
    public static void apply(Activity a) {
        if (!isDeviceOwner(a)) return;
        DevicePolicyManager d = dpm(a); ComponentName admin = admin(a);
        List<String> allowed = new ArrayList<>(); allowed.add(a.getPackageName()); allowed.add(Prefs.VK_PACKAGE); allowed.add(Prefs.TG_PACKAGE);
        String vpn = Prefs.getVpnPackage(a); if (!vpn.isEmpty()) allowed.add(vpn);
        d.setLockTaskPackages(admin, allowed.toArray(new String[0]));
        if (Build.VERSION.SDK_INT >= 28) d.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
        IntentFilter home = new IntentFilter(Intent.ACTION_MAIN); home.addCategory(Intent.CATEGORY_HOME); home.addCategory(Intent.CATEGORY_DEFAULT);
        d.addPersistentPreferredActivity(admin, home, new ComponentName(a, MainActivity.class));
        if (Prefs.isKioskEnabled(a) && d.isLockTaskPermitted(a.getPackageName())) a.startLockTask();
    }
    public static void exit(Activity a) {
        try { a.stopLockTask(); } catch (Exception ignored) {}
        if (isDeviceOwner(a)) dpm(a).clearPackagePersistentPreferredActivities(admin(a), a.getPackageName());
        Prefs.setKioskEnabled(a, false);
    }
    public static String configureAlwaysOnVpn(Context c, String vpnPackage) {
        if (!isDeviceOwner(c)) return "Требуется режим владельца устройства";
        if (vpnPackage == null || vpnPackage.trim().isEmpty()) return "VPN-пакет не задан";
        try { dpm(c).setAlwaysOnVpnPackage(admin(c), vpnPackage.trim(), false); return "Always-on VPN включён. В VPN-клиенте направьте через туннель только Telegram."; }
        catch (Exception e) { return "Не удалось включить VPN: " + e.getClass().getSimpleName(); }
    }
}
