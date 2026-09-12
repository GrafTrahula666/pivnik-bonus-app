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

public class MainActivity extends Activity {
    private TextView status;

    @Override protected void onCreate(Bundle b) { super.onCreate(b); hideSystemUi(); render(); }
    @Override protected void onResume() { super.onResume(); hideSystemUi(); if (Prefs.isKioskEnabled(this)) KioskController.apply(this); refreshStatus(); }

    private void hideSystemUi() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
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
        root.addView(title, lp());

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

        status = new TextView(this);
        status.setTextColor(Color.rgb(155,155,170));
        status.setTextSize(12);
        status.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams st = lp(); st.topMargin = dp(38);
        root.addView(status, st);
        setContentView(root);
        refreshStatus();
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
                "  •  Админ: удерживайте ПИВНИК");
    }

    private void openPlatform(boolean telegram) {
        String pkg = telegram ? Prefs.TG_PACKAGE : Prefs.VK_PACKAGE;
        String baseUri = telegram ? Prefs.getTgUri(this) : Prefs.getVkUri(this);
        if (baseUri == null || baseUri.trim().isEmpty()) {
            Toast.makeText(this, "Ссылка приложения не настроена", Toast.LENGTH_LONG).show();
            return;
        }
        if (!DeviceCredentialStore.hasToken(this)) {
            if (Prefs.isKioskEnabled(this)) {
                Toast.makeText(this, "Барный телефон ещё не привязан администратором", Toast.LENGTH_LONG).show();
                return;
            }
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
        EditText label = textField("Имя устройства", Prefs.getDeviceLabel(this));
        EditText pair = textField("Одноразовый код BAR-XXXX-XXXX", "");
        box.addView(vk); box.addView(tg); box.addView(vpn); box.addView(api); box.addView(label); box.addView(pair);

        String[] actions = KioskController.isDeviceOwner(this)
                ? new String[]{"Сохранить", "Привязать устройство", "Сбросить привязку", "Включить Kiosk", "Выйти из Kiosk", "Настроить Always-on VPN", "Системные настройки"}
                : new String[]{"Сохранить", "Привязать устройство", "Сбросить привязку", "Показать инструкцию Device Owner", "Системные настройки"};

        new AlertDialog.Builder(this)
                .setTitle("Пивник — администрирование")
                .setView(box)
                .setItems(actions, (dialog, which) -> {
                    saveAdminFields(vk, tg, vpn, api, label);
                    String action = actions[which];
                    if (action.equals("Привязать устройство")) pairDevice(pair.getText().toString(), label.getText().toString());
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
