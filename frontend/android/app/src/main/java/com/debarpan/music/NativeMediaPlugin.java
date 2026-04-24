package com.debarpan.music;

import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NativeMediaPlugin — Capacitor bridge between JavaScript and MusicService.
 *
 * JavaScript calls:
 *   NativeMedia.updateSession({ title, artist, album, artUrl, isPlaying, duration, position })
 *   NativeMedia.setPlaying({ isPlaying })
 *   NativeMedia.stop()
 */
@CapacitorPlugin(name = "NativeMedia")
public class NativeMediaPlugin extends Plugin {

    @PluginMethod
    public void updateSession(PluginCall call) {
        String title    = call.getString("title", "Unknown Title");
        String artist   = call.getString("artist", "Unknown Artist");
        String album    = call.getString("album", "DJ Debarpan");
        String artUrl   = call.getString("artUrl", "");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));
        double duration = call.getDouble("duration", 0.0);
        double position = call.getDouble("position", 0.0);

        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_UPDATE);
        intent.putExtra(MusicService.EXTRA_TITLE,    title);
        intent.putExtra(MusicService.EXTRA_ARTIST,   artist);
        intent.putExtra(MusicService.EXTRA_ALBUM,    album);

        intent.putExtra(MusicService.EXTRA_PLAYING,  playing);
        intent.putExtra(MusicService.EXTRA_DURATION, (long)(duration * 1000));
        intent.putExtra(MusicService.EXTRA_POSITION, (long)(position * 1000));

        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void setPlaying(PluginCall call) {
        boolean playing = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));
        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(playing ? MusicService.ACTION_PLAY : MusicService.ACTION_PAUSE);
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), MusicService.class));
        call.resolve();
    }
}
