package ru.pivnik.evotor.core;

/** Foreground-only scan admission. One request at a time; a scan is never queued for a later receipt. */
public final class ForegroundScan {
    private static final String READY = "Отсканируйте QR клиента сканером кассы.";
    private static final String WAITING = "Проверяем клиента… Дождитесь результата.";
    public interface Completion { void complete(String message); }
    public interface Resolver { void resolve(String payload, Completion completion); }
    public interface View { void show(String message); }

    private final Resolver resolver;
    private final View view;
    private boolean active;
    private boolean pending;
    private int generation;
    private String message = READY;

    public ForegroundScan(Resolver resolver, View view) {
        this.resolver = resolver;
        this.view = view;
    }

    public void resume() {
        active = true;
        view.show(pending ? WAITING : message);
    }

    public void pause() {
        active = false;
        generation++;
        message = READY;
    }

    public void barcode(String raw) {
        if (!active || pending) return;
        String payload = PivnikQr.detect(raw);
        if (payload == null) {
            message = "Это не QR клиента PIVNIK. Отсканируйте код из приложения клиента.";
            view.show(message);
            return;
        }
        pending = true;
        final int requestGeneration = generation;
        message = WAITING;
        view.show(message);
        resolver.resolve(payload, new Completion() {
            private boolean completed;
            @Override public void complete(String result) {
                if (completed) return;
                completed = true;
                pending = false;
                // A customer confirmed in a window we left must not appear attached to a later sale.
                message = generation == requestGeneration ? result : READY;
                if (active) view.show(message);
            }
        });
    }
}
