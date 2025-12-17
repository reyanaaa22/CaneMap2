package com.canemap.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import android.util.Base64;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final int PERMISSION_REQUEST_CODE = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 🔥 Enable camera access inside WebView (VERY IMPORTANT)
        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();

        // ✅ DO NOT request permissions on app launch - only request when needed

        // Configure WebView
        WebView webView = this.bridge.getWebView();
        if (webView != null) {

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);

            // Handle download requests coming from WebView
            webView.setDownloadListener(new DownloadListener() {
                @Override
                public void onDownloadStart(String url, String userAgent, String contentDisposition,
                        String mimetype, long contentLength) {

                    // 🔥 FIX: Prevent downloading HTML/JS/CSS pages
                    if (url.endsWith(".html") || url.endsWith(".htm") ||
                            url.contains(".html?") || url.contains(".htm?") ||
                            (mimetype != null && mimetype.equals("text/html")) ||
                            (mimetype != null && mimetype.equals("text/plain"))) {
                        System.out.println("⛔ BLOCKED download of HTML page: " + url);
                        return; // Don't download — WebView should load it normally
                    }

                    if (checkStoragePermission()) {
                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                        request.setMimeType(mimetype);
                        request.addRequestHeader("User-Agent", userAgent);
                        request.setDescription("Downloading file...");
                        request.setTitle("CaneMap Download");
                        request.allowScanningByMediaScanner();
                        request.setNotificationVisibility(
                                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        request.setDestinationInExternalPublicDir(
                                Environment.DIRECTORY_DOWNLOADS,
                                getFileNameFromUrl(url, contentDisposition));

                        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                        dm.enqueue(request);
                    }
                }
            });

            // JS interface for downloads & permissions
            webView.addJavascriptInterface(new Object() {

                @android.webkit.JavascriptInterface
                public void downloadFile(String base64Data, String filename, String mimeType) {
                    runOnUiThread(() -> {
                        if (checkStoragePermission()) {
                            try {
                                byte[] fileData = Base64.decode(base64Data, Base64.DEFAULT);
                                File downloadsDir = Environment
                                        .getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);

                                if (!downloadsDir.exists())
                                    downloadsDir.mkdirs();

                                File file = new File(downloadsDir, filename);
                                FileOutputStream fos = new FileOutputStream(file);
                                fos.write(fileData);
                                fos.close();

                                android.media.MediaScannerConnection.scanFile(
                                        MainActivity.this,
                                        new String[] { file.getAbsolutePath() },
                                        new String[] { mimeType != null ? mimeType : "application/octet-stream" },
                                        null);
                            } catch (Exception e) {
                                android.util.Log.e("Download", "Error saving file: " + e.getMessage());
                            }
                        } else {
                            // Permission not granted - this shouldn't happen if JavaScript checked properly
                            // But request permission anyway as a fallback
                            android.util.Log.w("Download", "Storage permission not granted when downloadFile called, requesting...");
                            requestStoragePermissions();
                        }
                    });
                }

                @android.webkit.JavascriptInterface
                public boolean hasStoragePermission() {
                    return checkStoragePermission();
                }

                @android.webkit.JavascriptInterface
                public boolean hasCameraPermission() {
                    return checkCameraPermission();
                }

                @android.webkit.JavascriptInterface
                public void requestStoragePermissions() {
                    runOnUiThread(() -> {
                        requestStoragePermissions();
                    });
                }

                @android.webkit.JavascriptInterface
                public void requestCameraPermission() {
                    runOnUiThread(() -> {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                                !checkCameraPermission()) {

                            ActivityCompat.requestPermissions(MainActivity.this,
                                    new String[] { Manifest.permission.CAMERA },
                                    PERMISSION_REQUEST_CODE);
                        }
                    });
                }

            }, "AndroidDownload");
        }
    }

    /**
     * Request storage and media permissions only (on demand)
     * Only requests storage/media permissions, not camera/audio/video
     */
    private void requestStoragePermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> permissionsToRequest = new ArrayList<>();

            // STORAGE BASED ON ANDROID VERSION
            // Only request storage/media permissions needed for file downloads
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Android 13+ (API 33+): Only request READ_MEDIA_IMAGES for file downloads
                if (ContextCompat.checkSelfPermission(this,
                        Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED) {
                    permissionsToRequest.add(Manifest.permission.READ_MEDIA_IMAGES);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10-12 (API 29-32): READ_EXTERNAL_STORAGE
                if (ContextCompat.checkSelfPermission(this,
                        Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    permissionsToRequest.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                }
            } else {
                // Android 9 and below: READ and WRITE_EXTERNAL_STORAGE
                if (ContextCompat.checkSelfPermission(this,
                        Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    permissionsToRequest.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                }
                if (ContextCompat.checkSelfPermission(this,
                        Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    permissionsToRequest.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
                }
            }

            if (!permissionsToRequest.isEmpty()) {
                ActivityCompat.requestPermissions(
                        this,
                        permissionsToRequest.toArray(new String[0]),
                        PERMISSION_REQUEST_CODE);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
            String[] permissions,
            int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    private boolean checkStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(this,
                    Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED;
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return ContextCompat.checkSelfPermission(this,
                    Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                    || Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        } else {
            return ContextCompat.checkSelfPermission(this,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        }
    }

    public boolean checkCameraPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private String getFileNameFromUrl(String url, String contentDisposition) {
        String filename = "download";

        if (contentDisposition != null && contentDisposition.contains("filename=")) {
            filename = contentDisposition.substring(contentDisposition.indexOf("filename=") + 9);
            filename = filename.replace("\"", "");
        } else if (url != null) {
            int slash = url.lastIndexOf('/');
            if (slash != -1 && slash < url.length() - 1) {
                filename = url.substring(slash + 1);
            }
        }

        return filename;
    }
}
