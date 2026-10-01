package ru.pivnik.kiosk.shift;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.time.ZonedDateTime;

public class TelegramShiftApiTest {
    private static long moscow(int hour, int minute) {
        return ZonedDateTime.of(2026, 10, 1, hour, minute, 0, 0, ShiftRules.BAR_ZONE).toInstant().toEpochMilli();
    }

    @Test public void startMessageShowsNameTimeAndLateness() {
        String text = TelegramShiftApi.startText("Иван", moscow(11, 5), true, null);
        assertTrue(text.contains("Иван"));
        assertTrue(text.contains("01.10 11:05"));
        assertTrue(text.contains("ОПОЗДАНИЕ"));
        assertFalse(TelegramShiftApi.startText("Иван", moscow(10, 0), false, null).contains("ОПОЗДАНИЕ"));
    }

    @Test public void startMessageWarnsAboutUnclosedPreviousShift() {
        assertTrue(TelegramShiftApi.startText("Иван", moscow(10, 0), false, "Пётр").contains("Пётр"));
    }

    @Test public void closeMessageShowsWorkedTime() {
        String text = TelegramShiftApi.closeText("Иван", moscow(11, 0), moscow(23, 30));
        assertTrue(text.contains("Начало: 01.10 11:00"));
        assertTrue(text.contains("Конец: 01.10 23:30"));
        assertTrue(text.contains("Отработано: 12 ч 30 мин"));
    }

    @Test public void captionNamesDocumentAndEmployee() {
        assertEquals("Табель — Иван", TelegramShiftApi.caption(Shift.KIND_REPORT, "Иван"));
        assertEquals("Чек закрытия", TelegramShiftApi.caption(Shift.KIND_RECEIPT, ""));
    }
}
