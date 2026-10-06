package ru.pivnik.evotor.core;

/** Short one-line notices for the bartender. Only the normal case is "PIVNIK ✓ <name>". */
public final class IndicatorText {
    private IndicatorText() {}

    public static String forBinding(BindingPolicy.Outcome outcome, ResolvedClient client, String boundName) {
        switch (outcome) {
            case BOUND:
            case ALREADY_BOUND:
                return "PIVNIK ✓ " + client.displayName;
            case REPLACED:
                return "PIVNIK ✓ " + client.displayName + " (замена)";
            case REPLACE_NEEDS_CONFIRMATION:
                return "PIVNIK: чек уже за " + boundName + ". Для замены отсканируйте QR ещё раз";
            case RECEIPT_CHANGED:
            default:
                return "PIVNIK: чек сменился — отсканируйте QR снова";
        }
    }

    public static String forFailure(ResolveResult.Kind kind) {
        switch (kind) {
            case NOT_FOUND:
                return "PIVNIK: QR не найден — продажа без привязки";
            case UNAUTHORIZED:
                return "PIVNIK: касса не авторизована — продажа без привязки";
            case RATE_LIMITED:
                return "PIVNIK: слишком часто — повторите позже";
            case UNAVAILABLE:
            default:
                return "PIVNIK: нет связи — продажа без привязки";
        }
    }

    public static String noOpenReceipt() {
        return "PIVNIK: сначала добавьте товар в чек";
    }

    public static String notConfigured() {
        return "PIVNIK: мост не настроен — продажа без привязки";
    }
}
