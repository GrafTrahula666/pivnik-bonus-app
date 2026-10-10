package ru.pivnik.evotor;

import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Owner-facing setup. Not part of the bartender flow: the sale itself never opens this screen. */
public final class SettingsActivity extends Activity {
    private EditText apiBase;
    private EditText session;
    private TextView status;
    private TextView connection;

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
        note.setText("HTTPS-адрес сервера PIVNIK и отдельный ключ кассы pvpos_… от администратора. "
                + "Ключ позволяет только узнать клиента по QR и отметить его в чеке. Сессия сотрудника не подходит.");
        root.addView(note);

        apiBase = new EditText(this);
        apiBase.setHint("https://… адрес сервера PIVNIK");
        apiBase.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        apiBase.setText(settings.apiBaseUrl());
        root.addView(apiBase);

        session = new EditText(this);
        session.setHint(settings.isConfigured() ? "Ключ сохранён. Введите для замены" : "Ключ кассы pvpos_…");
        session.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        session.setSaveEnabled(false);
        root.addView(session);

        Button save = new Button(this);
        save.setText("Сохранить");
        save.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                String base = apiBase.getText().toString().trim();
                if (!base.startsWith("https://")) {
                    Toast.makeText(SettingsActivity.this, "Нужен https:// адрес", Toast.LENGTH_SHORT).show();
                    return;
                }
                try { settings.save(base, session.getText().toString()); }
                catch (IllegalArgumentException error) {
                    Toast.makeText(SettingsActivity.this, error.getMessage(), Toast.LENGTH_SHORT).show();
                    return;
                } catch (IllegalStateException error) {
                    Toast.makeText(SettingsActivity.this, "Не удалось защитить ключ кассы", Toast.LENGTH_SHORT).show();
                    return;
                }
                session.setText("");
                refreshStatus(settings);
                Toast.makeText(SettingsActivity.this, "Сохранено", Toast.LENGTH_SHORT).show();
            }
        });
        root.addView(save);

        final Button check = new Button(this);
        check.setText("Проверить подключение");
        check.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                if (!settings.isConfigured()) {
                    connection.setText("Сначала введите адрес и ключ и нажмите «Сохранить».");
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

        setContentView(root);
    }

    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception error) { return "?"; }
    }

    private static String describe(String result) {
        if ("OK".equals(result)) return "Подключено: сервер отвечает, ключ принят.";
        if ("KEY".equals(result)) return "Сервер отвечает, но ключ кассы не подходит. Выпустите новый и введите его.";
        if (result.startsWith("HTTP ")) return "Сервер ответил: " + result + ". Проверьте адрес и что сервер работает.";
        String hint = result.contains("SSL") || result.contains("Certificate") || result.contains("Trust")
                ? "\nПохоже на проблему с сертификатом или временем на кассе."
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
