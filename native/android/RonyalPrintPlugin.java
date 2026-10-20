package PACKAGE_NAME_PLACEHOLDER;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "RonyalPrint")
public class RonyalPrintPlugin extends Plugin {
    private static final int MAX_IMPORT_BYTES = 25 * 1024 * 1024;
    private static final String TEMP_PATH_KEY = "_ronyalFileTempPath";
    private static final String TEMP_LENGTH_KEY = "_ronyalFileExpectedLength";

    @PluginMethod
    public void getPrintStatus(PluginCall call) {
        Activity activity = getActivity();
        JSObject result = new JSObject();
        result.put("apiLevel", Build.VERSION.SDK_INT);
        boolean available = activity != null && !activity.isFinishing();
        result.put("activityAvailable", available);
        if (!available) {
            result.put("printingFeature", false);
            result.put("printManagerAvailable", false);
            call.resolve(result);
            return;
        }
        result.put("printingFeature", activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PRINTING));
        result.put("printManagerAvailable", activity.getSystemService(Context.PRINT_SERVICE) instanceof PrintManager);
        call.resolve(result);
    }

    @PluginMethod
    public void printWebView(PluginCall call) {
        final Activity activity = getActivity();
        final String jobName = call.getString("name", "Ronyal Super Store Receipt");
        if (activity == null || activity.isFinishing()) {
            call.reject("The POS Android Activity is unavailable.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.KITKAT) {
            call.reject("System printing requires Android 4.4 or newer.");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                if (!activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PRINTING)) {
                    call.reject("Android system printing is unavailable.");
                    return;
                }
                Object service = activity.getSystemService(Context.PRINT_SERVICE);
                if (!(service instanceof PrintManager)) {
                    call.reject("Android PrintManager is unavailable.");
                    return;
                }
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView == null) {
                    call.reject("The POS WebView is unavailable.");
                    return;
                }
                PrintDocumentAdapter adapter = Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
                        ? webView.createPrintDocumentAdapter(jobName)
                        : webView.createPrintDocumentAdapter();
                PrintJob printJob = ((PrintManager) service).print(jobName, adapter, new PrintAttributes.Builder().build());
                if (printJob == null) {
                    call.reject("Android did not create a print job.");
                    return;
                }
                JSObject response = new JSObject();
                response.put("jobId", printJob.getId() == null ? "" : printJob.getId().toString());
                response.put("jobName", jobName);
                call.resolve(response);
            } catch (Exception e) {
                call.reject("Android printing error: " + safeMessage(e), e);
            }
        });
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Android context is unavailable.");
            return;
        }
        String fileName = call.getString("fileName", "ronyal-export.json");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String contentText = call.getString("contentText");
        if (contentText == null || contentText.isEmpty()) {
            call.reject("File content is missing.");
            return;
        }

        File tempFile = null;
        try {
            File cacheDir = new File(context.getCacheDir(), "ronyal-backups");
            if (!cacheDir.exists() && !cacheDir.mkdirs()) {
                throw new IllegalStateException("Could not create temporary backup folder.");
            }
            tempFile = File.createTempFile("ronyal-export-", ".tmp", cacheDir);
            try (FileOutputStream fos = new FileOutputStream(tempFile);
                 BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(fos, StandardCharsets.UTF_8))) {
                final int chunkSize = 8192;
                for (int offset = 0; offset < contentText.length(); offset += chunkSize) {
                    int end = Math.min(contentText.length(), offset + chunkSize);
                    writer.write(contentText, offset, end - offset);
                }
                writer.flush();
                fos.getFD().sync();
            }
            long expectedLength = tempFile.length();
            if (!tempFile.isFile() || expectedLength <= 0) {
                throw new IllegalStateException("Temporary backup is empty or incomplete.");
            }

            // Critical: don't persist the huge JSON payload inside Capacitor's saved PluginCall.
            // Keep only the small temporary-file path and expected byte count across the picker.
            call.getData().remove("contentText");
            call.getData().put(TEMP_PATH_KEY, tempFile.getAbsolutePath());
            call.getData().put(TEMP_LENGTH_KEY, expectedLength);
            call.save();

            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_TITLE, fileName);
            startActivityForResult(call, intent, "saveFileResult");
        } catch (Exception e) {
            deleteQuietly(tempFile);
            call.reject("Could not prepare backup for saving: " + safeMessage(e), e);
        }
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String tempPath = call.getData().optString(TEMP_PATH_KEY, null);
        long expectedLength = call.getData().optLong(TEMP_LENGTH_KEY, -1);
        File tempFile = tempPath == null ? null : new File(tempPath);
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            deleteQuietly(tempFile);
            call.reject("Save cancelled; no file was written.");
            return;
        }
        if (tempFile == null || !tempFile.isFile() || expectedLength <= 0 || tempFile.length() != expectedLength) {
            deleteQuietly(tempFile);
            call.reject("Temporary backup is missing or incomplete. Please export again.");
            return;
        }

        Uri uri = result.getData().getData();
        long copied = 0;
        try (InputStream in = new FileInputStream(tempFile);
             OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
            if (out == null) throw new IllegalStateException("Android could not open the destination.");
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                copied += read;
            }
            out.flush();
            if (copied <= 0 || copied != expectedLength) {
                throw new IllegalStateException("Backup write was incomplete (" + copied + " of " + expectedLength + " bytes).");
            }
        } catch (Exception e) {
            deleteQuietly(tempFile);
            call.reject("Could not save backup: " + safeMessage(e), e);
            return;
        }
        deleteQuietly(tempFile);
        JSObject response = new JSObject();
        response.put("saved", true);
        response.put("bytesWritten", copied);
        response.put("fileName", queryDisplayName(uri));
        response.put("uri", uri.toString());
        call.resolve(response);
    }

    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/json"));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "pickFileResult");
    }

    @ActivityCallback
    private void pickFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("No file was selected.");
            return;
        }
        Uri uri = result.getData().getData();
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IllegalStateException("Android could not open the selected file.");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                if (out.size() + read > MAX_IMPORT_BYTES) {
                    throw new IllegalArgumentException("Backup file exceeds the 25 MB limit.");
                }
                out.write(buffer, 0, read);
            }
            JSObject response = new JSObject();
            response.put("fileName", queryDisplayName(uri));
            response.put("contentBase64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Could not read backup: " + safeMessage(e), e);
        }
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            try { file.delete(); } catch (Exception ignored) { }
        }
    }

    private static String safeMessage(Exception e) {
        String message = e.getMessage();
        return message == null || message.trim().isEmpty() ? e.getClass().getSimpleName() : message;
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Fall back to a generic filename.
        }
        return "selected file";
    }
}
