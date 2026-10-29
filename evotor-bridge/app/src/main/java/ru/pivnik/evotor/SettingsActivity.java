package ru.pivnik.evotor;

import android.app.Activity;
import android.graphics.Typeface;
import android.graphics.Color;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import ru.pivnik.evotor.core.PosConfiguration;
import ru.evotor.framework.navigation.NavigationApi;

/** Owner-facing setup. Not part of the bartender flow: the sale itself never opens this screen. */
public final class SettingsActivity extends Activity {
    private EditText session;
    private TextView status;
    private TextView connection;
    private Button check;
    private Button keyCheck;
    private Button save;
    private Button diagnostics;
    private TextView title;
    private TextView note;
    private int normalTitleColor;
    private boolean checking;
    private static final int KEY_LENGTH = 49;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final BridgeSettings settings = Bridge.get(this).settings;
        int pad = (int) (16 * getResources().getDisplayMetrics().density);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        title = new TextView(this);
        normalTitleColor = title.getCurrentTextColor();
        title.setText("PIVNIK для Эвотора — подключение");
        title.setTextSize(20);
        root.addView(title);

        note = new TextView(this);
        note.setText("1. Проверьте связь с сервером — ключ для этого не нужен.\n"
                + "2. Когда связь работает, сохраните ключ кассы pvpos_… один раз. "
                + "При совместимом обновлении он сохраняется. Адрес сервера задан в приложении.");
        root.addView(note);

        // The normal path for a provisioned till is checking its identity, not asking
        // the owner to provision it again. Network-only checks belong to diagnostics.
        diagnostics = new Button(this);
        diagnostics.setText("Диагностика связи");
        diagnostics.setVisibility(settings.isConfigured() ? View.VISIBLE : View.GONE);
        diagnostics.setOnClickListener(view -> {
            boolean show = check.getVisibility() != View.VISIBLE;
            check.setVisibility(show ? View.VISIBLE : View.GONE);
            diagnostics.setText(show ? "Скрыть диагностику" : "Диагностика связи");
        });
        root.addView(diagnostics);

        check = new Button(this);
        check.setText("Проверить связь без ключа");
        check.setVisibility(settings.isConfigured() ? View.GONE : View.VISIBLE);
        check.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { runCheck(settings, false); }
        });
        root.addView(check);
        connection = new TextView(this);
        root.addView(connection);

        session = new EditText(this);
        session.setHint(settings.isConfigured() ? "Ключ сохранён. Введите для замены" : "pvpos_…");
        // Visible, no autocorrect: the owner types 49 characters by hand and must see each one.
        session.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        session.setTypeface(Typeface.MONOSPACE);
        session.setTextSize(18);
        session.setSingleLine(true);
        session.setSaveEnabled(false);
        root.addView(session);

        final TextView keyHint = new TextView(this);
        root.addView(keyHint);
        session.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence text, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence text, int start, int before, int count) {}
            @Override public void afterTextChanged(Editable text) {
                String raw = text.toString();
                String clean = PosConfiguration.cleanToken(raw);
                if (!clean.equals(raw)) {
                    session.setText(clean);
                    session.setSelection(clean.length());
                    return;
                }
                keyHint.setText(clean.isEmpty() ? ""
                        : PosConfiguration.validToken(clean) ? "Ключ выглядит правильно. Нажмите «Сохранить»."
                        : !clean.matches("[A-Za-z0-9_-]*") ? "В ключе есть русские буквы или лишние знаки: "
                                + "переключите клавиатуру на английскую. Символов: " + clean.length() + " из " + KEY_LENGTH
                        : "Символов: " + clean.length() + " из " + KEY_LENGTH
                                + (clean.startsWith("pvpos_") || "pvpos_".startsWith(clean) ? "" : ". Ключ начинается с pvpos_"));
            }
        });

        save = new Button(this);
        save.setText("Сохранить");
        save.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                String key = PosConfiguration.cleanToken(session.getText().toString());
                if (!key.isEmpty() && !PosConfiguration.validToken(key)) {
                    Toast.makeText(SettingsActivity.this, "В ключе " + key.length() + " символов, нужно " + KEY_LENGTH
                            + ". Проверьте ключ.", Toast.LENGTH_LONG).show();
                    return;
                }
                try { settings.save(key); }
                catch (IllegalArgumentException error) {
                    Toast.makeText(SettingsActivity.this, error.getMessage(), Toast.LENGTH_SHORT).show();
                    return;
                } catch (IllegalStateException error) {
                    Toast.makeText(SettingsActivity.this, "Не удалось защитить ключ кассы", Toast.LENGTH_SHORT).show();
                    return;
                }
                session.setText("");
                session.setHint("Ключ сохранён. Введите для замены");
                refreshStatus(settings);
                title.setText("PIVNIK — ключ сохранён");
                note.setText("Проверяем, принимает ли сервер сохранённый ключ кассы.");
                diagnostics.setVisibility(View.VISIBLE);
                check.setVisibility(View.GONE);
                Toast.makeText(SettingsActivity.this, "Сохранено", Toast.LENGTH_SHORT).show();
                keyCheck.setEnabled(true);
                keyCheck.performClick();
            }
        });
        root.addView(save);

        keyCheck = new Button(this);
        keyCheck.setText(settings.isConfigured() ? "Проверить подключение кассы" : "Проверить сохранённый ключ");
        keyCheck.setEnabled(settings.isConfigured());
        keyCheck.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { runCheck(settings, true); }
        });
        root.addView(keyCheck);

        Button back = new Button(this);
        back.setText("Вернуться к продаже");
        back.setOnClickListener(view -> {
            try {
                startActivity(NavigationApi.createIntentForSellReceiptEdit(false));
                finish();
            } catch (android.content.ActivityNotFoundException error) {
                Toast.makeText(this, "Откройте продажу через меню Эвотора", Toast.LENGTH_LONG).show();
            }
        });
        root.addView(back);

        status = new TextView(this);
        root.addView(status);
        refreshStatus(settings);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
        if (settings.isConfigured()) {
            title.setText("PIVNIK — ключ кассы сохранён");
            note.setText("Ключ уже находится в приложении. Проверяем подключение кассы автоматически.");
            keyCheck.requestFocus();
            runCheck(settings, true);
        } else check.requestFocus();
    }

    private void runCheck(final BridgeSettings settings, final boolean withKey) {
        if (checking) return;
        if (withKey && !settings.isConfigured()) {
            connection.setText("Ключ ещё не сохранён. Связь можно проверить без ключа.");
            return;
        }
        checking = true;
        final String checkedToken = withKey ? settings.deviceToken() : "";
        title.setTextColor(normalTitleColor);
        check.setEnabled(false);
        keyCheck.setEnabled(false);
        session.setEnabled(false);
        save.setEnabled(false);
        connection.setText((withKey ? "Проверяем сохранённый ключ…" : "Проверяем связь без ключа…")
                + "\nПодождите до 90 секунд.");
        new Thread(new Runnable() {
            @Override public void run() {
                final String answer = withKey ? PivnikApi.diagnoseKey(settings) : PivnikApi.diagnoseNetwork(settings);
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (isFinishing() || isDestroyed()) return;
                        checking = false;
                        check.setEnabled(true);
                        keyCheck.setEnabled(settings.isConfigured());
                        session.setEnabled(true);
                        save.setEnabled(true);
                        if (withKey && !checkedToken.equals(settings.deviceToken())) {
                            title.setText("Ключ кассы изменён");
                            note.setText("Повторите проверку подключения с новым ключом.");
                            connection.setText("");
                            return;
                        }
                        connection.setText(describe(answer));
                        if ("OK".equals(answer)) {
                            title.setText("Касса подключена ✓");
                            title.setTextColor(Color.rgb(90, 210, 140));
                            note.setText("Сервер отвечает, ключ кассы принят. Повторно вводить ключ не требуется.");
                            check.setVisibility(View.GONE);
                            diagnostics.setText("Диагностика связи");
                            keyCheck.setText("Перепроверить подключение");
                        } else if (withKey) {
                            title.setText("KEY".equals(answer) ? "Ключ кассы не принят" : "Не удалось проверить подключение");
                            title.setTextColor(Color.rgb(240, 190, 100));
                            note.setText("Ключ остаётся сохранённым. Результат проверки указан ниже.");
                        } else if (!"NETWORK_OK".equals(answer)) {
                            title.setText("Не удалось проверить связь");
                            title.setTextColor(Color.rgb(240, 190, 100));
                        }
                    }
                });
            }
        }).start();
    }

    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception error) { return "?"; }
    }

    private static String describe(String result) {
        if ("OK".equals(result)) return "Подключено: сервер отвечает, ключ принят.";
        if ("NETWORK_OK".equals(result)) return "Связь с сервером есть. Проверка выполнена без ключа. "
                + "Если ключ уже сохранён, нажмите «Проверить сохранённый ключ».";
        if ("KEY".equals(result)) return "Сервер отвечает, но сохранённый ключ не принят. Проверьте его действительность у администратора.";
        if (result.startsWith("HTTP ")) return "Сервер ответил неожиданно. Пришлите этот текст разработчику:\n" + result;
        // Issuer names (for example Google Trust Services) are diagnostic data,
        // not evidence that a timeout was a certificate validation failure.
        String errorLine = result.split("\n", 2)[0];
        String hint = errorLine.contains("SSL") || errorLine.contains("Certificate") || errorLine.contains("Trust")
                ? "\nПохоже на проблему с сертификатом или временем на кассе. Время на кассе: "
                        + new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.US).format(new Date())
                        + ". Если дата неверная, исправьте её в настройках кассы."
                : result.contains("UnknownHost") ? "\nКасса не находит сервер: проверьте адрес и интернет."
                : result.contains("Timeout") ? "\nСервер не отвечает вовремя: проверьте интернет кассы и настройки прокси приложения в кабинете Эвотора. Этап и проверку health пришлите разработчику." : "";
        return "Нет связи: " + result.substring(4) + hint;
    }

    private void refreshStatus(BridgeSettings settings) {
        String last = settings.lastStatus();
        status.setText("Версия " + versionName() + ". "
                + (settings.isConfigured() ? "Ключ сохранён." : "Ключ не сохранён. Связь можно проверить без ключа.")
                + (last.isEmpty() ? "" : "\nПоследнее событие: " + last));
    }
}
