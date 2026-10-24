package reforge.engine;

import java.io.File;
import java.net.InetSocketAddress;

import forge.gui.GuiBase;
import forge.model.FModel;

/**
 * Entry point. Loads Forge without any windows, then serves the web UI over a local WebSocket.
 *
 * Usage: java -jar re-forge-engine.jar --assets <forge/forge-gui folder> [--data <folder>] [--port N] [--exit-with-parent]
 * Prints "READY <port>" on stdout once the UI can connect (the Electron shell waits for it).
 */
public final class Main {
    public static final String VERSION = "0.1.0";

    public static void main(String[] args) throws Exception {
        launch(args, MatchStarter::startCommander);
    }

    /** Package-private injection lets the test launcher use real Forge scenarios without a test socket API. */
    static void launch(String[] args, EngineServer.MatchFactory matches) throws Exception {
        String assets = null;
        String data = defaultDataDir();
        int port = 0;
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--assets" -> assets = args[++i];
                case "--data" -> data = args[++i];
                case "--port" -> port = Integer.parseInt(args[++i]);
                case "--exit-with-parent" -> exitWhenStdinCloses();
                default -> fail("Unknown argument: " + args[i]);
            }
        }
        if (assets == null || !new File(assets, "res").isDirectory()) {
            fail("--assets must point to Forge's forge-gui folder (the one that holds res/)");
        }

        System.setProperty("java.awt.headless", "true");
        writeProfile(new File(assets), new File(data));
        GuiBase.setInterface(new HeadlessGui(assets));
        Settings settings = new Settings(new File(data));
        FModel.initialize(null, settings::applyTo);

        int imagePort = new ImageServer().start();
        EngineServer server = new EngineServer(new InetSocketAddress("127.0.0.1", port), "http://127.0.0.1:" + imagePort + "/card", settings, matches);
        server.start();
        System.out.println("READY " + server.awaitPort());
        System.out.flush();
    }

    /** %APPDATA%\RE-Forge on Windows, ~/.re-forge elsewhere. */
    private static String defaultDataDir() {
        String appData = System.getenv("APPDATA");
        return appData != null ? new File(appData, "RE-Forge").getPath() : new File(System.getProperty("user.home"), ".re-forge").getPath();
    }

    /**
     * Forge keeps preferences, decks, achievements and image caches under the folders named in
     * forge.profile.properties (next to res/), defaulting to the same %APPDATA%\Forge an installed
     * Forge uses. Point them at our own folder so we never touch a real Forge install's data.
     * Must run before anything loads ForgeConstants.
     */
    private static void writeProfile(File assets, File data) throws java.io.IOException {
        java.util.Properties profile = new java.util.Properties();
        profile.setProperty("userDir", new File(data, "user").getAbsolutePath());
        profile.setProperty("cacheDir", new File(data, "cache").getAbsolutePath());
        try (var out = java.nio.file.Files.newOutputStream(new File(assets, "forge.profile.properties").toPath())) {
            profile.store(out, "Written by RE:Forge on every start");
        }
    }

    /** The launcher keeps our stdin open; when it dies the pipe closes and we must not linger as an orphan. */
    private static void exitWhenStdinCloses() {
        Thread watcher = new Thread(() -> {
            try {
                while (System.in.read() != -1) { /* ignore input */ }
            } catch (java.io.IOException ignored) {
                // a broken pipe means the parent is gone too
            }
            System.exit(0);
        }, "parent-watch");
        watcher.setDaemon(true);
        watcher.start();
    }

    private static void fail(String message) {
        System.err.println(message);
        System.exit(2);
    }
}
