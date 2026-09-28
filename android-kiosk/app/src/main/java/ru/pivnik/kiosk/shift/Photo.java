package ru.pivnik.kiosk.shift;

import org.json.JSONException;
import org.json.JSONObject;

/** A locally saved photo; it counts as sent only after the server confirmed the upload. */
public final class Photo {
    public final String id;
    public final String path;
    public boolean uploaded;

    public Photo(String id, String path, boolean uploaded) {
        this.id = id;
        this.path = path;
        this.uploaded = uploaded;
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject().put("id", id).put("path", path).put("uploaded", uploaded);
    }

    static Photo fromJson(JSONObject json) {
        return new Photo(json.optString("id"), json.optString("path"), json.optBoolean("uploaded"));
    }
}
