package ru.pivnik.kiosk.shift;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands the camera app exactly one writable file (the pending capture) via a
 * temporary URI grant. Not exported; serves no other path. Replaces AndroidX
 * FileProvider, which this dependency-free project does not include.
 */
public final class PhotoOutputProvider extends ContentProvider {
    public static final String AUTHORITY = "ru.pivnik.kiosk.photos";
    public static final Uri CAPTURE_URI = Uri.parse("content://" + AUTHORITY + "/capture.jpg");

    public static File captureFile(android.content.Context context) {
        return new File(context.getCacheDir(), "capture.jpg");
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        if (!"/capture.jpg".equals(uri.getPath())) throw new FileNotFoundException("unknown");
        return captureFile(getContext());
    }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.parseMode(mode));
    }

    @Override public String getType(Uri uri) { return "image/jpeg"; }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file;
        try { file = fileFor(uri); } catch (FileNotFoundException e) { return null; }
        MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        cursor.addRow(new Object[]{file.getName(), file.length()});
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
