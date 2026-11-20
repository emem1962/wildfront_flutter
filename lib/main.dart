import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(const [
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const WildfrontApp());
}

class WildfrontApp extends StatelessWidget {
  const WildfrontApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WILDFRONT 3D',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: const Color(0xFF10170F),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF9DCD69),
          brightness: Brightness.dark,
        ),
      ),
      home: const GameScreen(),
    );
  }
}

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  late final WebViewController _webController;
  bool _loading = true;
  bool _ready = false;
  bool _pageFinished = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _createWebView();
  }

  Future<void> _createWebView() async {
    try {
      final controller = WebViewController();
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      await controller.setBackgroundColor(const Color(0xFF10170F));
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            _pageFinished = true;
            if (mounted && _ready) setState(() => _loading = false);
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame == true && mounted) {
              setState(() {
                _loading = false;
                _loadError = error.description;
              });
            }
          },
          onNavigationRequest: (request) {
            // Keep the game self-contained inside the app's WebView.
            if (request.url.startsWith('https://appassets.androidplatform.net/') ||
                request.url.startsWith('https://cdn.jsdelivr.net/')) {
              return NavigationDecision.navigate;
            }
            return NavigationDecision.prevent;
          },
        ),
      );

      if (controller.platform is AndroidWebViewController) {
        final androidController = controller.platform as AndroidWebViewController;
        // Allows local-network ws:// multiplayer during LAN testing.
        // Use wss:// for a public production server.
        await androidController.setMixedContentMode(MixedContentMode.alwaysAllow);
        await androidController.setMediaPlaybackRequiresUserGesture(false);
      }

      await controller.loadFlutterAsset('assets/game/index.html');
      if (!mounted) return;
      setState(() {
        _webController = controller;
        _ready = true;
        _loading = !_pageFinished;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (_ready) WebViewWidget(controller: _webController),
          if (_loading)
            const ColoredBox(
              color: Color(0xFF10170F),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.forest_rounded, size: 54, color: Color(0xFF9DCD69)),
                    SizedBox(height: 14),
                    Text('WILDFRONT 3D', style: TextStyle(
                      color: Color(0xFFE8F0DC), fontSize: 22,
                      fontWeight: FontWeight.w900, letterSpacing: 3,
                    )),
                    SizedBox(height: 10),
                    SizedBox(width: 170, child: LinearProgressIndicator(
                      color: Color(0xFF9DCD69), backgroundColor: Color(0xFF293326),
                    )),
                    SizedBox(height: 10),
                    Text('Av sahası hazırlanıyor...', style: TextStyle(color: Colors.white60)),
                  ],
                ),
              ),
            ),
          if (_loadError != null)
            ColoredBox(
              color: const Color(0xFF10170F),
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.wifi_off_rounded, color: Color(0xFFE3A36B), size: 42),
                      const SizedBox(height: 12),
                      const Text('Oyun yüklenemedi', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      Text(_loadError!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white60)),
                      const SizedBox(height: 16),
                      FilledButton.icon(
                        onPressed: () {
                          setState(() {
                            _loadError = null;
                            _loading = true;
                          });
                          _webController.reload();
                        },
                        icon: const Icon(Icons.refresh),
                        label: const Text('Yeniden dene'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
