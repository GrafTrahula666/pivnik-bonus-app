package ru.pivnik.kiosk.shift;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.UUID;

/** Photograph and submit one document set: report (табель), receipt (чек) or invoices. */
public class DocumentActivity extends Activity {
    public static final String EXTRA_KIND = "kind";
    private static final int REQUEST_CAMERA = 11;
    private static final int REQUEST_PICK = 12;
    private static final String STATE_RETAKE = "retake";

    private String kind;
    private String retakePhotoId;
    private boolean busy;
    private LinearLayout root;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        kind = getIntent().getStringExtra(EXTRA_KIND);
        if (!Shift.KIND_REPORT.equals(kind) && !Shift.KIND_RECEIPT.equals(kind) && !Shift.KIND_INVOICE.equals(kind)) { finish(); return; }
        if (state != null) retakePhotoId = state.getString(STATE_RETAKE);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Ui.BACKGROUND);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(Ui.dp(this, 24), Ui.dp(this, 32), Ui.dp(this, 24), Ui.dp(this, 32));
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString(STATE_RETAKE, retakePhotoId);
    }

    @Override protected void onResume() {
        super.onResume();
        render();
    }

    private ShiftController controller() { return ShiftService.get(this).controller; }

    private void render() {
        Shift shift = controller().current();
        if (shift == null || !Shift.STATUS_OPEN.equals(shift.status)) { finish(); return; }
        Doc doc = shift.doc(kind);
        boolean invoice = Shift.KIND_INVOICE.equals(kind);
        boolean accepted = !invoice && Doc.ACCEPTED.equals(doc.status);
        boolean checking = busy || Doc.CHECKING.equals(doc.status);
        root.removeAllViews();

        TextView title = Ui.text(this, Ui.docTitle(kind), 26, Color.WHITE, true);
        root.addView(title, Ui.wide(this, 0));
        String hint = Shift.KIND_REPORT.equals(kind)
                ? "Сфотографируйте табель целиком, ровно и без бликов. Если мелкие записи плохо видно — добавьте фото отдельных участков (до 3 фото)."
                : Shift.KIND_RECEIPT.equals(kind)
                ? "Сфотографируйте чек закрытия смены отдельно от табеля. Длинный чек можно снять частями (до 3 фото)."
                : "Сфотографируйте накладные и другие документы (до 10 фото за раз). На закрытие смены это не влияет.";
        root.addView(Ui.text(this, hint, 16, Ui.MUTED, false), Ui.wide(this, 8));

        TextView status = Ui.text(this, "", 18, Color.WHITE, true);
        if (accepted) {
            status.setText(Shift.KIND_REPORT.equals(kind) ? "Отчёт принят ✓" : "Чек принят ✓");
            status.setTextColor(Ui.OK);
        } else if (checking) {
            status.setText(invoice ? "Отправляю… Не закрывайте экран." : "Проверяю документ… Не закрывайте экран.");
        } else if (Doc.REJECTED.equals(doc.status)) {
            StringBuilder text = new StringBuilder("Не принято:");
            for (String problem : doc.problems) text.append("\n• ").append(problem);
            status.setText(text.toString());
            status.setTextColor(Ui.WARN);
        } else if (Doc.ERROR.equals(doc.status)) {
            status.setText(doc.error.isEmpty() ? ShiftController.NETWORK_ERROR : doc.error);
            status.setTextColor(Ui.WARN);
        } else if (invoice && doc.sentCount > 0) {
            status.setText("Отправлено владельцам: " + doc.sentCount + " фото");
            status.setTextColor(Ui.OK);
        }
        if (status.getText().length() > 0) root.addView(status, Ui.wide(this, 20));

        for (int i = 0; i < doc.photos.size(); i++) root.addView(photoRow(doc.photos.get(i), i + 1, accepted || checking), Ui.wide(this, 16));

        int max = ShiftRules.maxPhotos(kind);
        if (!accepted) {
            Button camera = Ui.button(this, doc.photos.isEmpty() ? "СДЕЛАТЬ ФОТО" : "ДОБАВИТЬ ФОТО (" + doc.photos.size() + " из " + max + ")");
            camera.setEnabled(!checking && doc.photos.size() < max);
            camera.setOnClickListener(v -> { retakePhotoId = null; openCamera(); });
            root.addView(camera, Ui.wide(this, 20));
            Button gallery = Ui.button(this, "ВЫБРАТЬ ИЗ ГАЛЕРЕИ");
            gallery.setEnabled(!checking && doc.photos.size() < max);
            gallery.setOnClickListener(v -> { retakePhotoId = null; openPicker(); });
            root.addView(gallery, Ui.wide(this, 12));
            String sendText = Doc.ERROR.equals(doc.status) ? "ПОВТОРИТЬ" : invoice ? "ОТПРАВИТЬ ВЛАДЕЛЬЦАМ" : "ОТПРАВИТЬ НА ПРОВЕРКУ";
            Button send = Ui.button(this, sendText);
            send.setEnabled(!checking && !doc.photos.isEmpty());
            send.setOnClickListener(v -> submit());
            root.addView(send, Ui.wide(this, 12));
        }
        Button back = Ui.button(this, "НАЗАД");
        back.setOnClickListener(v -> finish());
        root.addView(back, Ui.wide(this, 24));
    }

    private LinearLayout photoRow(Photo photo, int number, boolean locked) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        ImageView thumb = new ImageView(this);
        thumb.setAdjustViewBounds(true);
        thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
        Bitmap preview = thumbnail(photo.path);
        if (preview != null) thumb.setImageBitmap(preview);
        row.addView(thumb, new LinearLayout.LayoutParams(Ui.dp(this, 110), Ui.dp(this, 140)));

        LinearLayout side = new LinearLayout(this);
        side.setOrientation(LinearLayout.VERTICAL);
        side.setPadding(Ui.dp(this, 14), 0, 0, 0);
        side.addView(Ui.text(this, "Фото " + number + (photo.uploaded ? " · загружено" : ""), 16, Ui.MUTED, false));
        if (!locked) {
            Button retake = Ui.button(this, "ПЕРЕСНЯТЬ");
            retake.setOnClickListener(v -> { retakePhotoId = photo.id; openCamera(); });
            side.addView(retake, Ui.wide(this, 6));
            Button delete = Ui.button(this, "УДАЛИТЬ");
            delete.setOnClickListener(v -> {
                controller().removePhoto(kind, photo.id);
                render();
            });
            side.addView(delete, Ui.wide(this, 6));
        }
        row.addView(side, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        return row;
    }

    private static Bitmap thumbnail(String path) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, bounds);
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 360) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        return BitmapFactory.decodeFile(path, options);
    }

    private void openCamera() {
        File capture = PhotoOutputProvider.captureFile(this);
        //noinspection ResultOfMethodCallIgnored
        capture.delete();
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, PhotoOutputProvider.CAPTURE_URI);
        intent.setClipData(ClipData.newRawUri("capture", PhotoOutputProvider.CAPTURE_URI));
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQUEST_CAMERA);
        } catch (Exception e) {
            Toast.makeText(this, "Камера недоступна. Администратор: включите Kiosk заново.", Toast.LENGTH_LONG).show();
        }
    }

    private void openPicker() {
        Intent intent = Build.VERSION.SDK_INT >= 33
                ? new Intent(MediaStore.ACTION_PICK_IMAGES)
                : new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(intent, REQUEST_PICK);
        } catch (Exception e) {
            Toast.makeText(this, "Выбор фото недоступен", Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK) return;
        final Uri picked = requestCode == REQUEST_PICK && data != null ? data.getData() : null;
        if (requestCode == REQUEST_PICK && picked == null) return;
        final String replaces = retakePhotoId;
        retakePhotoId = null;
        busy = true;
        render();
        ShiftService service = ShiftService.get(this);
        service.worker.execute(() -> {
            String error = null;
            try {
                byte[] original = picked == null
                        ? Files.readAllBytes(PhotoOutputProvider.captureFile(this).toPath())
                        : readAll(picked);
                String id = UUID.randomUUID().toString();
                File target = new File(service.photoDir(), id + ".jpg");
                PhotoProcessor.process(original, target);
                service.controller.addPhoto(kind, id, target.getAbsolutePath(), replaces);
            } catch (Exception e) {
                error = e.getMessage() == null ? "Не удалось сохранить фото" : e.getMessage();
            } finally {
                //noinspection ResultOfMethodCallIgnored
                PhotoOutputProvider.captureFile(this).delete();
            }
            final String message = error;
            runOnUiThread(() -> {
                busy = false;
                if (message != null) Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                render();
            });
        });
    }

    private byte[] readAll(Uri uri) throws IOException {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("Фото недоступно");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) {
                out.write(buffer, 0, read);
                if (out.size() > 40 * 1024 * 1024) throw new IOException("Фото слишком большое");
            }
            return out.toByteArray();
        }
    }

    private void submit() {
        busy = true;
        render();
        ShiftService.get(this).worker.execute(() -> {
            String error = null;
            try {
                controller().submit(kind);
            } catch (IllegalStateException e) {
                error = e.getMessage();
            } catch (Exception ignored) {
                // Network/server errors are stored on the document and shown with «Повторить».
            }
            final String message = error;
            runOnUiThread(() -> {
                busy = false;
                if (message != null) Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                render();
                Shift shift = controller().current();
                if (shift != null && !Shift.KIND_INVOICE.equals(kind) && Doc.ACCEPTED.equals(shift.doc(kind).status)) {
                    Toast.makeText(this, Shift.KIND_REPORT.equals(kind) ? "Отчёт принят" : "Чек принят", Toast.LENGTH_LONG).show();
                }
            });
        });
    }
}
