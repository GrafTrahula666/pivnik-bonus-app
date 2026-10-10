package ru.pivnik.evotor;

import android.app.Activity;
import android.graphics.Typeface;
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

/** Owner-facing setup. Not part of the bartender flow: the sale itself never opens this screen. */
public final class SettingsActivity extends Activity {
    private EditText apiBase;
    private EditText session;
    private TextView status;
    private TextView connection;
    private Button check;
    private static final int KEY_LENGTH = 49;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final BridgeSettings settings = Bridge.get(this).settings;
        int pad = (int) (16 * getResources().getDisplayMetrics().density);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("PIVNIK для Эвотора — подключение");
        title.setTextSize(20);
        root.addView(title);

        TextView note = new TextView(this);
        note.setText("Введите ключ кассы pvpos_… от администратора (или отсканируйте его QR, если сканер "
                + "печатает в поле) и нажмите «Сохранить». Адрес сервера уже заполнен. "
                + "Ключ позволяет только узнать клиента по QR и отметить его в чеке.");
        root.addView(note);

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

        TextView baseLabel = new TextView(this);
        baseLabel.setText("Адрес сервера (менять не нужно):");
        root.addView(baseLabel);

        apiBase = new EditText(this);
        apiBase.setHint("https://… адрес сервера PIVNIK");
        apiBase.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        apiBase.setText(settings.apiBaseUrl());
        root.addView(apiBase);

        Button save = new Button(this);
        save.setText("Сохранить");
        save.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                String base = apiBase.getText().toString().trim();
                if (!base.startsWith("https://")) {
                    Toast.makeText(SettingsActivity.this, "Нужен https:// адрес", Toast.LENGTH_SHORT).show();
                    return;
                }
                String key = PosConfiguration.cleanToken(session.getText().toString());
                if (!key.isEmpty() && !PosConfiguration.validToken(key)) {
                    Toast.makeText(SettingsActivity.this, "В ключе " + key.length() + " символов, нужно " + KEY_LENGTH
                            + ". Проверьте ключ.", Toast.LENGTH_LONG).show();
                    return;
                }
                try { settings.save(base, key); }
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
                Toast.makeText(SettingsActivity.this, "Сохранено", Toast.LENGTH_SHORT).show();
                check.performClick();
            }
        });
        root.addView(save);

        check = new Button(this);
        check.setText("Проверить подключение");
        check.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                if (!settings.isConfigured()) {
                    connection.setText("Сначала введите ключ кассы и нажмите «Сохранить».");
                    return;
                }
                check.setEnabled(false);
                connection.setText("Проверяем…");
                new Thread(new Runnable() {
                    @Override public void run() {
                        final String result = PivnikApi.diagnose(settings);
                        runOnUiThread(new Runnable() {
                            @Override public void run() {
                                check.setEnabled(true);
                                connection.setText(describe(result));
                            }
                        });
                    }
                }).start();
            }
        });
        root.addView(check);

        connection = new TextView(this);
        root.addView(connection);

        status = new TextView(this);
        root.addView(status);
        refreshStatus(settings);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
        if (!settings.isConfigured()) session.requestFocus();
    }

    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception error) { return "?"; }
    }

    private static String describe(String result) {
        if ("OK".equals(result)) return "Подключено: сервер отвечает, ключ принят.";
        if ("KEY".equals(result)) return "Сервер отвечает, но ключ кассы не подходит. Выпустите новый и введите его.";
        if (result.startsWith("HTTP ")) return "Сервер ответил неожиданно. Пришлите этот текст разработчику:\n" + result;
        String hint = result.contains("SSL") || result.contains("Certificate") || result.contains("Trust")
                ? "\nПохоже на проблему с сертификатом или временем на кассе. Время на кассе: "
                        + new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.US).format(new Date())
                        + ". Если дата неверная, исправьте её в настройках кассы."
                : result.contains("UnknownHost") ? "\nКасса не находит сервер: проверьте адрес и интернет."
                : result.contains("Timeout") ? "\nСервер не отвечает вовремя: проверьте интернет кассы." : "";
        return "Нет связи: " + result.substring(4) + hint;
    }

    private void refreshStatus(BridgeSettings settings) {
        String last = settings.lastStatus();
        status.setText("Версия " + versionName() + ". "
                + (settings.isConfigured() ? "Настроено." : "Не настроено.")
                + (last.isEmpty() ? "" : "\nПоследнее событие: " + last));
    }
}
