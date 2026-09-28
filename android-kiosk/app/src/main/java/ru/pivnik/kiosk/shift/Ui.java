package ru.pivnik.kiosk.shift;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** The kiosk's existing look: dark background, large default Material buttons, no custom decoration. */
public final class Ui {
    public static final int BACKGROUND = Color.rgb(11, 11, 16);
    public static final int CARD = Color.rgb(24, 24, 32);
    public static final int MUTED = Color.rgb(170, 170, 185);
    public static final int OK = Color.rgb(110, 214, 140);
    public static final int WARN = Color.rgb(255, 176, 92);
    public static final int DANGER = Color.rgb(255, 107, 107);

    private Ui() {}

    public static int dp(Context c, int v) { return (int) (v * c.getResources().getDisplayMetrics().density + 0.5f); }

    public static Button button(Context c, String text) {
        Button b = new Button(c);
        b.setText(text);
        b.setTextSize(18);
        b.setAllCaps(false);
        b.setMinHeight(dp(c, 72));
        return b;
    }

    public static TextView text(Context c, String value, int sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    public static LinearLayout card(Context c) {
        LinearLayout card = new LinearLayout(c);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(c, 20), dp(c, 18), dp(c, 20), dp(c, 20));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(CARD);
        bg.setCornerRadius(dp(c, 16));
        card.setBackground(bg);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        return card;
    }

    public static LinearLayout.LayoutParams wide(Context c, int topMarginDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(c, topMarginDp);
        return lp;
    }

    public static String docTitle(String kind) {
        if (Shift.KIND_REPORT.equals(kind)) return "ОБЩИЙ ОТЧЁТ / ТАБЕЛЬ";
        if (Shift.KIND_RECEIPT.equals(kind)) return "ЧЕК ЗАКРЫТИЯ СМЕНЫ";
        return "ДОКУМЕНТЫ / НАКЛАДНЫЕ";
    }

    /** One-line status for the main shift card. */
    public static String docStatusLine(Doc doc) {
        String name = Shift.KIND_REPORT.equals(doc.kind) ? "Отчёт / табель" : "Чек закрытия";
        switch (doc.status) {
            case Doc.ACCEPTED: return Shift.KIND_REPORT.equals(doc.kind) ? "Отчёт принят ✓" : "Чек принят ✓";
            case Doc.CHECKING: return name + ": проверяется…";
            case Doc.REJECTED: return name + ": не принят — переснимите";
            case Doc.ERROR: return name + ": не отправлен — повторите";
            default: return name + ": не сдан" + (doc.photos.isEmpty() ? "" : " (фото: " + doc.photos.size() + ")");
        }
    }

    public static int docStatusColor(Doc doc) {
        if (Doc.ACCEPTED.equals(doc.status)) return OK;
        if (Doc.REJECTED.equals(doc.status) || Doc.ERROR.equals(doc.status)) return WARN;
        return Color.WHITE;
    }
}
