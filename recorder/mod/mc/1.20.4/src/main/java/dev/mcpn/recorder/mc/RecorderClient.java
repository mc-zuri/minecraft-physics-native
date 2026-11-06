package dev.mcpn.recorder.mc;

import dev.mcpn.recorder.Log;
import dev.mcpn.recorder.Recorder;
import net.fabricmc.api.ClientModInitializer;

public final class RecorderClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        Log.info("loaded (%s)", System.getProperty("recorder.scenarios", "no recorder.scenarios"));
        Recorder.init(new BridgeImpl());
    }
}
