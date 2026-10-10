package ru.pivnik.evotor;

import android.content.Context;
import android.util.Log;
import java.io.InputStream;
import java.net.URLConnection;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Old terminal firmware (Android 6/7.0) does not trust ISRG Root X1, so Let's Encrypt
 * certificates fail before any request reaches the server. The system roots stay in use;
 * the roots bundled in res/raw/pivnik_roots.pem (ISRG X1/X2, GTS R1/R3/R4) are an extra
 * fallback. Hostname checks are unchanged (HttpsURLConnection's default verifier).
 */
final class PivnikTls {
    private static volatile SSLSocketFactory factory;

    private PivnikTls() {}

    static void install(Context context) {
        if (factory != null) return;
        try {
            X509TrustManager system = trustManager(null);
            KeyStore bundled = KeyStore.getInstance(KeyStore.getDefaultType());
            bundled.load(null, null);
            try (InputStream in = context.getResources().openRawResource(R.raw.pivnik_roots)) {
                int index = 0;
                for (Certificate cert : CertificateFactory.getInstance("X.509").generateCertificates(in)) {
                    bundled.setCertificateEntry("pivnik-root-" + index++, cert);
                }
            }
            SSLContext tls = SSLContext.getInstance("TLS");
            tls.init(null, new TrustManager[] { new Combined(system, trustManager(bundled)) }, null);
            factory = tls.getSocketFactory();
        } catch (Exception error) {
            Log.w(Bridge.TAG, "bundled roots unavailable; using system trust only");
        }
    }

    static void apply(URLConnection connection) {
        SSLSocketFactory current = factory;
        if (current != null && connection instanceof HttpsURLConnection) {
            ((HttpsURLConnection) connection).setSSLSocketFactory(current);
        }
    }

    private static X509TrustManager trustManager(KeyStore store) throws Exception {
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(store);
        for (TrustManager manager : tmf.getTrustManagers()) {
            if (manager instanceof X509TrustManager) return (X509TrustManager) manager;
        }
        throw new IllegalStateException("no X509TrustManager");
    }

    private static final class Combined implements X509TrustManager {
        private final X509TrustManager system;
        private final X509TrustManager bundled;

        Combined(X509TrustManager system, X509TrustManager bundled) {
            this.system = system;
            this.bundled = bundled;
        }

        @Override public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            system.checkClientTrusted(chain, authType);
        }

        @Override public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            try {
                system.checkServerTrusted(chain, authType);
            } catch (CertificateException systemError) {
                try {
                    bundled.checkServerTrusted(chain, authType);
                } catch (CertificateException ignored) {
                    throw systemError;
                }
            }
        }

        @Override public X509Certificate[] getAcceptedIssuers() {
            X509Certificate[] a = system.getAcceptedIssuers();
            X509Certificate[] b = bundled.getAcceptedIssuers();
            X509Certificate[] all = new X509Certificate[a.length + b.length];
            System.arraycopy(a, 0, all, 0, a.length);
            System.arraycopy(b, 0, all, a.length, b.length);
            return all;
        }
    }
}
