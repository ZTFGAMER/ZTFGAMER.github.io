import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    private let jsBridgeScript = """
    (function () {
      function send(name, payload) {
        try {
          if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[name]) {
            window.webkit.messageHandlers[name].postMessage(String(payload));
          }
        } catch (_) {}
      }

      window.addEventListener('error', function (e) {
        var msg = '[window.error] ' + (e.message || 'unknown');
        if (e.filename) msg += ' @ ' + e.filename + ':' + e.lineno + ':' + e.colno;
        send('jsError', msg);
      });

      window.addEventListener('unhandledrejection', function (e) {
        var reason = e.reason && (e.reason.stack || e.reason.message || e.reason);
        send('jsError', '[unhandledrejection] ' + String(reason));
      });

      ['log', 'warn', 'error'].forEach(function (level) {
        var orig = console[level];
        console[level] = function () {
          var args = Array.prototype.slice.call(arguments).map(function (x) {
            try { return typeof x === 'string' ? x : JSON.stringify(x); }
            catch (_) { return String(x); }
          });
          send('jsConsole', '[' + level + '] ' + args.join(' '));
          return orig.apply(console, arguments);
        };
      });
    })();
    """

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let schemeHandler = LocalSchemeHandler()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "app")
        let userContentController = WKUserContentController()
        userContentController.add(context.coordinator, name: "jsError")
        userContentController.add(context.coordinator, name: "jsConsole")
        userContentController.addUserScript(
            WKUserScript(source: jsBridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        )
        configuration.userContentController = userContentController

        let pagePreferences = WKWebpagePreferences()
        pagePreferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences = pagePreferences
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        if let appURL = URL(string: "app://dist-ios/index.html") {
            webView.load(URLRequest(url: appURL))
        } else {
            let fallback = "<html><body style='background:#200;color:#fff;font-family:-apple-system;padding:24px;'>dist-ios/index.html 未找到，请先执行 npm run build:ios-web 再重新构建 iOS。</body></html>"
            webView.loadHTMLString(fallback, baseURL: nil)
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if let text = message.body as? String {
                print("[WKBridge][\(message.name)] \(text)")
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("[WK] didFinish")
            webView.evaluateJavaScript("document.readyState") { value, error in
                if let error {
                    print("[WK] readyState eval error: \(error)")
                } else {
                    print("[WK] readyState=\(String(describing: value))")
                }
            }
            webView.evaluateJavaScript("""
              (function(){
                var scripts = Array.from(document.scripts || []).map(function(s){
                  return { type: s.type || '', src: s.getAttribute('src') || '' };
                });
                var app = document.getElementById('app');
                return JSON.stringify({ href: location.href, scripts: scripts, appChildren: app ? app.children.length : -1 });
              })();
            """) { value, error in
                if let error {
                    print("[WK] page snapshot error: \(error)")
                } else {
                    print("[WK] page snapshot=\(String(describing: value))")
                }
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                webView.evaluateJavaScript("""
                  (function(){
                    var app = document.getElementById('app');
                    var hasCanvas = !!document.querySelector('canvas');
                    return JSON.stringify({ hasCanvas: hasCanvas, appChildren: app ? app.children.length : -1, bodyBg: getComputedStyle(document.body).backgroundColor });
                  })();
                """) { value, error in
                    if let error {
                        print("[WK] post-1.5s snapshot error: \(error)")
                    } else {
                        print("[WK] post-1.5s snapshot=\(String(describing: value))")
                    }
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[WK] didFail navigation: \(error)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[WK] didFailProvisionalNavigation: \(error)")
        }
    }
}

final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    private var loggedImageRequests = 0

    private func contentType(for path: String) -> String {
        if path.hasSuffix(".html") { return "text/html" }
        if path.hasSuffix(".js") { return "application/javascript" }
        if path.hasSuffix(".css") { return "text/css" }
        if path.hasSuffix(".json") { return "application/json" }
        if path.hasSuffix(".png") { return "image/png" }
        if path.hasSuffix(".jpg") || path.hasSuffix(".jpeg") { return "image/jpeg" }
        if path.hasSuffix(".webp") { return "image/webp" }
        if path.hasSuffix(".svg") { return "image/svg+xml" }
        if path.hasSuffix(".woff2") { return "font/woff2" }
        if path.hasSuffix(".woff") { return "font/woff" }
        return "application/octet-stream"
    }

    private func textEncodingName(for path: String) -> String? {
        if path.hasSuffix(".html") || path.hasSuffix(".js") || path.hasSuffix(".css") || path.hasSuffix(".json") {
            return "utf-8"
        }
        return nil
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            return
        }

        let hostPart = url.host?.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        let pathPart = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let rawPath = hostPart.isEmpty
            ? pathPart
            : (pathPart.isEmpty ? hostPart : "\(hostPart)/\(pathPart)")
        let resolvedPath: String
        if rawPath.hasPrefix("dist-ios/") || rawPath.hasPrefix("resource/") {
            resolvedPath = rawPath
        } else if rawPath.isEmpty {
            resolvedPath = "dist-ios/index.html"
        } else {
            resolvedPath = "dist-ios/\(rawPath)"
        }

        let fileURL = Bundle.main.bundleURL.appendingPathComponent(resolvedPath)
        if (resolvedPath.hasSuffix(".png") || resolvedPath.hasSuffix(".webp")) && loggedImageRequests < 8 {
            loggedImageRequests += 1
            print("[WK][asset] \(resolvedPath)")
        }
        do {
            let data = try Data(contentsOf: fileURL)
            let contentType = contentType(for: resolvedPath)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": contentType,
                    "Access-Control-Allow-Origin": "*"
                ]
            )
            if let response {
                urlSchemeTask.didReceive(response)
            } else {
                let fallbackResponse = URLResponse(
                    url: url,
                    mimeType: contentType,
                    expectedContentLength: data.count,
                    textEncodingName: textEncodingName(for: resolvedPath)
                )
                urlSchemeTask.didReceive(fallbackResponse)
            }
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            print("[WK][asset-missing] \(resolvedPath)")
            let notFound = NSError(domain: "LocalSchemeHandler", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "Missing resource: \(resolvedPath)"
            ])
            urlSchemeTask.didFailWithError(notFound)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
