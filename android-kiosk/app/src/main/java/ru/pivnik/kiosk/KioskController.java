package ru.pivnik.kiosk;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.MediaStore;
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
        for (String pkg : systemPhotoPackages(a)) if (!allowed.contains(pkg)) allowed.add(pkg);
        d.setLockTaskPackages(admin, allowed.toArray(new String[0]));
        if (Build.VERSION.SDK_INT >= 28) d.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
        IntentFilter home = new IntentFilter(Intent.ACTION_MAIN); home.addCategory(Intent.CATEGORY_HOME); home.addCategory(Intent.CATEGORY_DEFAULT);
        d.addPersistentPreferredActivity(admin, home, new ComponentName(a, MainActivity.class));
        if (Prefs.isKioskEnabled(a) && d.isLockTaskPermitted(a.getPackageName())) a.startLockTask();
    }
    /** Pre-installed camera / photo-picker apps the shift documents screen hands off to. */
    static List<String> systemPhotoPackages(Context c) {
        List<String> result = new ArrayList<>();
        PackageManager pm = c.getPackageManager();
        List<Intent> probes = new ArrayList<>();
        probes.add(new Intent(MediaStore.ACTION_IMAGE_CAPTURE));
        // Android 13+ has the narrow system photo picker; the generic GET_CONTENT
        // handlers (Photos, Drive, Files) would widen what can run inside the kiosk.
        if (Build.VERSION.SDK_INT >= 33) probes.add(new Intent(MediaStore.ACTION_PICK_IMAGES));
        else probes.add(new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE));
        for (Intent probe : probes) {
            for (ResolveInfo info : pm.queryIntentActivities(probe, 0)) {
                ApplicationInfo app = info.activityInfo == null ? null : info.activityInfo.applicationInfo;
                if (app == null || (app.flags & ApplicationInfo.FLAG_SYSTEM) == 0) continue;
                if (!result.contains(app.packageName)) result.add(app.packageName);
            }
        }
        return result;
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
