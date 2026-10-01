package ru.pivnik.kiosk;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Handler;
import android.os.Looper;
import android.widget.FrameLayout;
import android.widget.ScrollView;

import ru.pivnik.kiosk.shift.Doc;
import ru.pivnik.kiosk.shift.DocumentActivity;
import ru.pivnik.kiosk.shift.HttpShiftApi;
import ru.pivnik.kiosk.shift.Shift;
import ru.pivnik.kiosk.shift.ShiftController;
import ru.pivnik.kiosk.shift.ShiftCredentialStore;
import ru.pivnik.kiosk.shift.ShiftRules;
import ru.pivnik.kiosk.shift.ShiftService;
import ru.pivnik.kiosk.shift.Ui;

public class MainActivity extends Activity {
    private static final long SYNC_INTERVAL_MS = 30_000;

    private TextView status;
    private TextView battery;
    private LinearLayout shiftCard;
    private boolean shiftBusy;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable syncTick = new Runnable() {
        @Override public void run() {
            syncShiftStart();
            handler.postDelayed(this, SYNC_INTERVAL_MS);
        }
    };
    private final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { showBattery(intent); }
    };

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        render();
        getWindow().getDecorView().post(this::hideSystemUi);
    }

    @Override protected void onResume() {
        super.onResume();
        getWindow().getDecorView().post(this::hideSystemUi);
        if (Prefs.isKioskEnabled(this)) KioskController.apply(this);
        refreshStatus();
        // ACTION_BATTERY_CHANGED is sticky: registering returns the current level immediately.
        showBattery(registerReceiver(batteryReceiver, new IntentFilter(Intent.ACTION_BATTERY_CHANGED)));
        renderShift();
        handler.post(syncTick);
    }

    @Override protected void onPause() {
        super.onPause();
        handler.removeCallbacks(syncTick);
        try { unregisterReceiver(batteryReceiver); } catch (IllegalArgumentException ignored) {}
    }

    private void showBattery(Intent intent) {
        if (battery == null || intent == null) return;
        int plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
        battery.setText(ShiftRules.batteryLabel(
                intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
                intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1),
                plugged != 0));
    }

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = decor.getWindowInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    private void render() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(44), dp(24), dp(24));
        root.setBackgroundColor(Color.rgb(11,11,16));

        TextView title = new TextView(this);
        title.setText("ПИВНИК");
        title.setTextColor(Color.WHITE);
        title.setTextSize(34);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        title.setOnLongClickListener(v -> { showAdminPin(); return true; });
        // Small, always-visible battery level in the corner of the title row.
        FrameLayout titleRow = new FrameLayout(this);
        titleRow.addView(title, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
        battery = new TextView(this);
        battery.setTextColor(Color.rgb(170,170,185));
        battery.setTextSize(15);
        titleRow.addView(battery, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END));
        root.addView(titleRow, lp());

        TextView sub = new TextView(this);
        sub.setText("Терминал бармена");
        sub.setTextColor(Color.rgb(170,170,185));
        sub.setTextSize(16);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams slp = lp(); slp.bottomMargin = dp(42);
        root.addView(sub, slp);

        Button vk = button("Открыть Пивник — VK");
        vk.setOnClickListener(v -> openPlatform(false));
        root.addView(vk, buttonLp());

        Button tg = button("Открыть Пивник — Telegram");
        tg.setOnClickListener(v -> openPlatform(true));
        LinearLayout.LayoutParams tlp = buttonLp(); tlp.topMargin = dp(16);
        root.addView(tg, tlp);

        shiftCard = Ui.card(this);
        LinearLayout.LayoutParams clp = lp(); clp.topMargin = dp(24);
        root.addView(shiftCard, clp);

        Button docs = button("ДОКУМЕНТЫ / НАКЛАДНЫЕ");
        docs.setOnClickListener(v -> openDocuments(Shift.KIND_INVOICE));
        LinearLayout.LayoutParams dlp = buttonLp(); dlp.topMargin = dp(16);
        root.addView(docs, dlp);

        status = new TextView(this);
        status.setTextColor(Color.rgb(155,155,170));
        status.setTextSize(12);
        status.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams st = lp(); st.topMargin = dp(38);
        root.addView(status, st);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(11,11,16));
        scroll.addView(root);
        setContentView(scroll);
        refreshStatus();
        renderShift();
    }

    // ---------------- current shift card ----------------

    private ShiftController shifts() { return ShiftService.get(this).controller; }

    private void renderShift() {
        if (shiftCard == null) return;
        shiftCard.removeAllViews();
        shiftCard.addView(Ui.text(this, "ТЕКУЩАЯ СМЕНА", 15, Ui.MUTED, true), lp());
        Shift shift = shifts().current();
        if (shift == null) {
            shiftCard.addView(Ui.text(this, "Смена не открыта", 20, Color.WHITE, false), Ui.wide(this, 8));
            Button start = button("НАЧАТЬ СМЕНУ");
            start.setEnabled(!shiftBusy);
            start.setOnClickListener(v -> askEmployeeName());
            shiftCard.addView(start, Ui.wide(this, 16));
            return;
        }
        TextView name = Ui.text(this, shift.employeeName, 28, Color.WHITE, true);
        shiftCard.addView(name, Ui.wide(this, 8));
        String opened = "Смена открыта · " + ShiftRules.localTime(shift.openedAt);
        if (!ShiftRules.sameBarDay(shift.openedAt, System.currentTimeMillis())) opened += " · " + ShiftRules.localDate(shift.openedAt);
        shiftCard.addView(Ui.text(this, opened, 20, Color.WHITE, false), Ui.wide(this, 4));
        if (shift.late) shiftCard.addView(Ui.text(this, "ОПОЗДАНИЕ", 18, Ui.DANGER, true), Ui.wide(this, 4));
        if (!shift.serverConfirmed) {
            String sync = shift.syncError.isEmpty() ? "Отправляю владельцам…" : shift.syncError;
            shiftCard.addView(Ui.text(this, sync, 15, shift.syncError.isEmpty() ? Ui.MUTED : Ui.WARN, false), Ui.wide(this, 6));
        }

        for (Doc doc : new Doc[]{shift.report, shift.receipt}) {
            TextView line = Ui.text(this, Ui.docStatusLine(doc), 18, Ui.docStatusColor(doc), true);
            shiftCard.addView(line, Ui.wide(this, 16));
            if (!Doc.ACCEPTED.equals(doc.status)) {
                Button open = button(Shift.KIND_REPORT.equals(doc.kind) ? "СДАТЬ ОТЧЁТ / ТАБЕЛЬ" : "СДАТЬ ЧЕК");
                open.setOnClickListener(v -> openDocuments(doc.kind));
                shiftCard.addView(open, Ui.wide(this, 8));
            }
        }

        boolean canClose = ShiftRules.canClose(shift);
        TextView gate = Ui.text(this, canClose
                ? "Документы приняты.\nСмену можно завершить."
                : "Документы не сданы.\nЗавершить смену невозможно.", 18, canClose ? Ui.OK : Ui.WARN, true);
        gate.setGravity(Gravity.CENTER);
        shiftCard.addView(gate, Ui.wide(this, 20));
        Button close = button("ЗАВЕРШИТЬ СМЕНУ");
        close.setEnabled(canClose && !shiftBusy);
        close.setOnClickListener(v -> confirmClose());
        shiftCard.addView(close, Ui.wide(this, 12));

        if (ShiftRules.isStale(shift, System.currentTimeMillis())) {
            Button replace = button("НАЧАТЬ НОВУЮ СМЕНУ");
            replace.setEnabled(!shiftBusy);
            replace.setOnClickListener(v -> warnPreviousUnclosed(shift));
            shiftCard.addView(replace, Ui.wide(this, 12));
        }
        if (!shift.unclosedWarnings.isEmpty()) showServerUnclosedWarning(shift);
    }

    private void askEmployeeName() {
        EditText input = new EditText(this);
        input.setHint("Имя");
        input.setSingleLine(true);
        input.setTextSize(22);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        new AlertDialog.Builder(this)
                .setTitle("Введите имя")
                .setView(input)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("НАЧАТЬ", (d, w) -> {
                    try {
                        shifts().openShift(input.getText().toString());
                    } catch (IllegalArgumentException e) {
                        Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                        askEmployeeName();
                        return;
                    }
                    renderShift();
                    syncShiftStart();
                }).show();
    }

    private void warnPreviousUnclosed(Shift previous) {
        new AlertDialog.Builder(this)
                .setTitle("Предыдущая смена не была закрыта")
                .setMessage(previous.employeeName + ", открыта " + ShiftRules.localDate(previous.openedAt) + " в "
                        + ShiftRules.localTime(previous.openedAt)
                        + ".\n\nОна не будет удалена. Владельцы получат уведомление.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Продолжить", (d, w) -> askEmployeeName())
                .show();
    }

    private void showServerUnclosedWarning(Shift shift) {
        String names = String.join(", ", shift.unclosedWarnings);
        shifts().clearWarnings();
        new AlertDialog.Builder(this)
                .setTitle("Предыдущая смена не была закрыта")
                .setMessage("Незакрытая смена: " + names + ".\nВладельцы уведомлены.")
                .setPositiveButton("Понятно", null)
                .show();
    }

    private void syncShiftStart() {
        Shift shift = shifts().current();
        if (shift == null || shift.serverConfirmed || shiftBusy) return;
        ShiftService.get(this).worker.execute(() -> {
            try { shifts().syncStart(); } catch (Exception ignored) {}
            runOnUiThread(this::renderShift);
        });
    }

    private void openDocuments(String kind) {
        Shift shift = shifts().current();
        if (shift == null) { Toast.makeText(this, "Сначала начните смену", Toast.LENGTH_LONG).show(); return; }
        startActivity(new Intent(this, DocumentActivity.class).putExtra(DocumentActivity.EXTRA_KIND, kind));
    }

    private void confirmClose() {
        new AlertDialog.Builder(this)
                .setTitle("Завершить смену?")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("ЗАВЕРШИТЬ", (d, w) -> {
                    shiftBusy = true;
                    renderShift();
                    ShiftService.get(this).worker.execute(() -> {
                        String message;
                        try {
                            shifts().close();
                            message = "Смена завершена";
                        } catch (java.io.IOException e) {
                            message = "Нет связи с сервером. Смена не закрыта — попробуйте ещё раз.";
                        } catch (Exception e) {
                            message = safeMessage(e);
                        }
                        final String text = message;
                        runOnUiThread(() -> {
                            shiftBusy = false;
                            Toast.makeText(this, text, Toast.LENGTH_LONG).show();
                            renderShift();
                        });
                    });
                }).show();
    }

    private void enrollShifts(String code, String label) {
        if (code == null || code.trim().isEmpty()) {
            Toast.makeText(this, "Введите код подключения смен", Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, "Подключаю смены…", Toast.LENGTH_SHORT).show();
        ShiftService.get(this).worker.execute(() -> {
            String message;
            try {
                String token = new HttpShiftApi(this).enroll(code, label).optString("deviceToken", "");
                if (!token.startsWith("pvkshift_")) throw new IllegalStateException("Сервер не вернул ключ смен");
                ShiftCredentialStore.save(this, token);
                message = "Смены подключены";
            } catch (Exception e) {
                message = "Не удалось подключить смены: " + safeMessage(e);
            }
            final String text = message;
            runOnUiThread(() -> { refreshStatus(); Toast.makeText(this, text, Toast.LENGTH_LONG).show(); syncShiftStart(); });
        });
    }

    private Button button(String s) {
        Button b = new Button(this); b.setText(s); b.setTextSize(18); b.setAllCaps(false); b.setMinHeight(dp(72)); return b;
    }

    private void refreshStatus() {
        if (status == null) return;
        status.setText(
                (Prefs.isKioskEnabled(this) ? "KIOSK: ON" : "KIOSK: OFF") +
                "  •  Device Owner: " + (KioskController.isDeviceOwner(this) ? "OK" : "не настроен") +
                "\nDEVICE AUTH: " + (DeviceCredentialStore.hasToken(this) ? "OK" : "не привязан") +
                "  •  СМЕНЫ: " + (ShiftCredentialStore.hasToken(this) ? "OK" : "не подключены") +
                "\nАдмин: удерживайте ПИВНИК");
    }

    private void openPlatform(boolean telegram) {
        String pkg = telegram ? Prefs.TG_PACKAGE : Prefs.VK_PACKAGE;
        String baseUri = telegram ? Prefs.getTgUri(this) : Prefs.getVkUri(this);
        if (baseUri == null || baseUri.trim().isEmpty()) {
            Toast.makeText(this, "Ссылка приложения не настроена", Toast.LENGTH_LONG).show();
            return;
        }
        if (!DeviceCredentialStore.hasToken(this)) {
            launch(pkg, baseUri);
            return;
        }
        if (status != null) status.setText("Получаю одноразовый доступ…");
        new Thread(() -> {
            try {
                DeviceAuthClient.BootstrapResult bootstrap = DeviceAuthClient.bootstrap(this);
                String securedUri = telegram
                        ? DeviceAuthClient.telegramUri(baseUri, bootstrap.code)
                        : DeviceAuthClient.vkUri(baseUri, bootstrap.code);
                runOnUiThread(() -> { refreshStatus(); launch(pkg, securedUri); });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    refreshStatus();
                    Toast.makeText(this, "Не удалось открыть Пивник: " + safeMessage(e), Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    private void launch(String pkg, String uriText) {
        Intent i = null;
        if (uriText != null && !uriText.trim().isEmpty()) {
            i = new Intent(Intent.ACTION_VIEW, Uri.parse(uriText.trim()));
            i.setPackage(pkg);
        }
        if (i == null || getPackageManager().resolveActivity(i, 0) == null) i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { Toast.makeText(this, "Приложение не установлено: " + pkg, Toast.LENGTH_LONG).show(); return; }
        try { startActivity(i); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "Не удалось открыть приложение", Toast.LENGTH_LONG).show(); }
    }

    private void showAdminPin() {
        if (!Prefs.hasPin(this)) { showCreatePin(); return; }
        EditText pin = pinField("PIN администратора");
        new AlertDialog.Builder(this)
                .setTitle("Администратор")
                .setView(pin)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Войти", (d,w) -> {
                    if (Prefs.verifyPin(this, pin.getText().toString())) showAdminPanel();
                    else Toast.makeText(this, "Неверный PIN", Toast.LENGTH_SHORT).show();
                }).show();
    }

    private void showCreatePin() {
        EditText pin = pinField("Создайте PIN (минимум 4 цифры)");
        new AlertDialog.Builder(this)
                .setTitle("Первичная настройка")
                .setMessage("PIN хранится только на телефоне в виде хэша и не связан с данными Пивника.")
                .setView(pin)
                .setCancelable(false)
                .setPositiveButton("Сохранить", (d,w) -> {
                    String v = pin.getText().toString();
                    if (v.length() < 4) {
                        Toast.makeText(this, "Минимум 4 цифры", Toast.LENGTH_LONG).show();
                        showCreatePin();
                    } else {
                        Prefs.setPin(this, v);
                        showAdminPanel();
                    }
                }).show();
    }

    private void showAdminPanel() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), 0, dp(20), 0);
        EditText vk = textField("VK deep link", Prefs.getVkUri(this));
        EditText tg = textField("Telegram deep link", Prefs.getTgUri(this));
        EditText vpn = textField("VPN package (например com.wireguard.android)", Prefs.getVpnPackage(this));
        EditText api = textField("HTTPS сервер Пивника", Prefs.getApiBaseUrl(this));
        EditText shiftApi = textField("HTTPS сервер смен", Prefs.getShiftApiBaseUrl(this));
        EditText label = textField("Имя устройства", Prefs.getDeviceLabel(this));
        EditText pair = textField("Одноразовый код BAR-XXXX-XXXX", "");
        EditText shiftCode = textField("Код подключения смен (с сервера)", "");
        box.addView(vk); box.addView(tg); box.addView(vpn); box.addView(api); box.addView(shiftApi); box.addView(label); box.addView(pair); box.addView(shiftCode);

        String[] actions = KioskController.isDeviceOwner(this)
                ? new String[]{"Сохранить", "Привязать устройство", "Сбросить привязку", "Подключить смены", "Включить Kiosk", "Выйти из Kiosk", "Настроить Always-on VPN", "Системные настройки"}
                : new String[]{"Сохранить", "Привязать устройство", "Сбросить привязку", "Подключить смены", "Показать инструкцию Device Owner", "Системные настройки"};

        new AlertDialog.Builder(this)
                .setTitle("Пивник — администрирование")
                .setView(box)
                .setItems(actions, (dialog, which) -> {
                    saveAdminFields(vk, tg, vpn, api, label); Prefs.saveShiftServer(this, shiftApi.getText().toString());
                    String action = actions[which];
                    if (action.equals("Привязать устройство")) pairDevice(pair.getText().toString(), label.getText().toString());
                    else if (action.equals("Подключить смены")) enrollShifts(shiftCode.getText().toString(), label.getText().toString());
                    else if (action.equals("Сбросить привязку")) {
                        DeviceCredentialStore.clear(this); refreshStatus(); Toast.makeText(this, "Локальный ключ удалён", Toast.LENGTH_SHORT).show();
                    }
                    else if (action.equals("Включить Kiosk")) { Prefs.setKioskEnabled(this, true); KioskController.apply(this); refreshStatus(); }
                    else if (action.equals("Выйти из Kiosk")) { KioskController.exit(this); refreshStatus(); startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)); }
                    else if (action.equals("Настроить Always-on VPN")) Toast.makeText(this, KioskController.configureAlwaysOnVpn(this, vpn.getText().toString()), Toast.LENGTH_LONG).show();
                    else if (action.equals("Показать инструкцию Device Owner")) showOwnerHelp();
                    else if (action.equals("Системные настройки")) { try { startActivity(new Intent(Settings.ACTION_SETTINGS)); } catch (Exception ignored) {} }
                    else Toast.makeText(this, "Сохранено", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Закрыть", null)
                .show();
    }

    private void saveAdminFields(EditText vk, EditText tg, EditText vpn, EditText api, EditText label) {
        Prefs.saveLinks(this, vk.getText().toString(), tg.getText().toString(), vpn.getText().toString());
        Prefs.saveServer(this, api.getText().toString(), label.getText().toString());
    }

    private void pairDevice(String code, String label) {
        if (code == null || code.trim().isEmpty()) {
            Toast.makeText(this, "Введите одноразовый код привязки", Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, "Привязываю устройство…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                DeviceAuthClient.PairResult result = DeviceAuthClient.pair(this, code, label);
                runOnUiThread(() -> {
                    refreshStatus();
                    Toast.makeText(this, "Устройство привязано: " + result.label, Toast.LENGTH_LONG).show();
                });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this, "Привязка не выполнена: " + safeMessage(e), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private void showOwnerHelp() {
        new AlertDialog.Builder(this)
                .setTitle("Полный Kiosk")
                .setMessage("Для жёсткой блокировки Android приложение должно стать владельцем выделенного устройства. На подготовленном телефоне через ADB:\n\nadb shell dpm set-device-owner ru.pivnik.kiosk/.PivnikDeviceAdminReceiver\n\nБез Device Owner приложение работает как лаунчер, но Android не даёт полностью заблокировать системный интерфейс.")
                .setPositiveButton("Понятно", null).show();
    }

    private String safeMessage(Exception e) {
        String value = e == null ? "неизвестная ошибка" : e.getMessage();
        return value == null || value.trim().isEmpty() ? e.getClass().getSimpleName() : value;
    }

    private EditText pinField(String h) { EditText e = new EditText(this); e.setHint(h); e.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD); return e; }
    private EditText textField(String h, String v) { EditText e = new EditText(this); e.setHint(h); e.setText(v == null ? "" : v); e.setSingleLine(true); return e; }
    private LinearLayout.LayoutParams buttonLp() { return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); }
    private LinearLayout.LayoutParams lp() { return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); }
    private int dp(int v) { return (int)(v * getResources().getDisplayMetrics().density + 0.5f); }
}
