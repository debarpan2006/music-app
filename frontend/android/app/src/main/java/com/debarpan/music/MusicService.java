package com.debarpan.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;
import android.os.Binder;

/**
 * MusicService — Native Android Foreground Service.
 *
 * CRITICAL FIX: We now request Android AudioFocus. Without AudioFocus,
 * Samsung One UI 8's Now Bar completely ignores the app's MediaSession.
 * This is the missing piece that makes the Now Bar appear.
 */
public class MusicService extends Service {

    public static final String CHANNEL_ID    = "dj_debarpan_media_v2";
    public static final String ACTION_UPDATE = "com.debarpan.music.ACTION_UPDATE";
    public static final String ACTION_PLAY   = "com.debarpan.music.ACTION_PLAY";
    public static final String ACTION_PAUSE  = "com.debarpan.music.ACTION_PAUSE";
    public static final String ACTION_STOP   = "com.debarpan.music.ACTION_STOP";

    public static final String EXTRA_TITLE    = "title";
    public static final String EXTRA_ARTIST   = "artist";
    public static final String EXTRA_ALBUM    = "album";
    public static final String EXTRA_PLAYING  = "isPlaying";
    public static final String EXTRA_DURATION = "duration";
    public static final String EXTRA_POSITION = "position";

    private MediaSessionCompat  mediaSession;
    private NotificationManager notifManager;
    private AudioManager        audioManager;
    private AudioFocusRequest   audioFocusRequest;

    private String  currentTitle  = "DJ Debarpan";
    private String  currentArtist = "Now Playing";
    private boolean isPlaying     = false;

    private final IBinder binder = new LocalBinder();
    public class LocalBinder extends Binder {
        MusicService getService() { return MusicService.this; }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        notifManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        audioManager  = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createNotificationChannel();
        setupMediaSession();
    }

    private void setupMediaSession() {
        mediaSession = new MediaSessionCompat(this, "DJDebarpan");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );

        // Minimal callback — real playback control happens in JavaScript
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay()  { broadcastAction("PLAY");  }
            @Override public void onPause() { broadcastAction("PAUSE"); }
            @Override public void onSkipToNext()     { broadcastAction("NEXT"); }
            @Override public void onSkipToPrevious() { broadcastAction("PREV"); }
        });

        setPlaybackState(PlaybackStateCompat.STATE_PAUSED, 0);
        mediaSession.setActive(true);
    }

    private void broadcastAction(String action) {
        // We send a broadcast that the JS layer can optionally listen to
        Intent i = new Intent("com.debarpan.music.MEDIA_CONTROL");
        i.putExtra("action", action);
        sendBroadcast(i);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;

        MediaButtonReceiver.handleIntent(mediaSession, intent);

        String action = intent.getAction() != null ? intent.getAction() : ACTION_UPDATE;

        switch (action) {
            case ACTION_UPDATE:
                currentTitle  = intent.getStringExtra(EXTRA_TITLE);
                currentArtist = intent.getStringExtra(EXTRA_ARTIST);
                String album  = intent.getStringExtra(EXTRA_ALBUM);
                isPlaying     = intent.getBooleanExtra(EXTRA_PLAYING, false);
                long duration = intent.getLongExtra(EXTRA_DURATION, 0);
                long position = intent.getLongExtra(EXTRA_POSITION, 0);

                if (isPlaying) requestAudioFocus();
                updateMetadata(currentTitle, currentArtist, album, duration);
                setPlaybackState(
                    isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    position
                );
                showNotification();
                break;

            case ACTION_PLAY:
                isPlaying = true;
                requestAudioFocus();
                setPlaybackState(PlaybackStateCompat.STATE_PLAYING, 0);
                showNotification();
                break;

            case ACTION_PAUSE:
                isPlaying = false;
                setPlaybackState(PlaybackStateCompat.STATE_PAUSED, 0);
                showNotification();
                break;

            case ACTION_STOP:
                abandonAudioFocus();
                mediaSession.setActive(false);
                stopForeground(true);
                stopSelf();
                break;
        }

        return START_STICKY;
    }

    // ── AudioFocus (THE KEY to Samsung Now Bar) ────────────────────────
    private void requestAudioFocus() {
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();

        audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attrs)
            .setAcceptsDelayedFocusGain(true)
            .setWillPauseWhenDucked(false)
            .setOnAudioFocusChangeListener(focusChange -> {
                // WebView handles actual audio; we just track focus state
                switch (focusChange) {
                    case AudioManager.AUDIOFOCUS_LOSS:
                    case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                        // Don't actually pause — JS audio handles this
                        break;
                }
            })
            .build();

        audioManager.requestAudioFocus(audioFocusRequest);
    }

    private void abandonAudioFocus() {
        if (audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        }
    }

    // ── MediaSession helpers ───────────────────────────────────────────
    private void updateMetadata(String title, String artist, String album, long durationMs) {
        mediaSession.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE,
                       title  != null ? title  : "Unknown")
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST,
                       artist != null ? artist : "Unknown")
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM,
                       album  != null ? album  : "DJ Debarpan")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
            .build());
    }

    private void setPlaybackState(int state, long positionMs) {
        mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                PlaybackStateCompat.ACTION_SEEK_TO
            )
            .setState(state, positionMs, 1f)
            .build());
        mediaSession.setActive(state == PlaybackStateCompat.STATE_PLAYING);
    }

    // ── Foreground Notification ────────────────────────────────────────
    private void showNotification() {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent prevPI = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS);
        PendingIntent playPI = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_PLAY_PAUSE);
        PendingIntent nextPI = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT);

        androidx.media.app.NotificationCompat.MediaStyle style =
            new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2);

        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(currentTitle  != null ? currentTitle  : "DJ Debarpan")
            .setContentText(currentArtist != null ? currentArtist : "Now Playing")
            .setContentIntent(openPending)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setStyle(style)
            .addAction(android.R.drawable.ic_media_previous, "Prev", prevPI)
            .addAction(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play", playPI
            )
            .addAction(android.R.drawable.ic_media_next, "Next", nextPI)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(1, notif);
        }
    }

    private void createNotificationChannel() {
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "DJ Debarpan Music", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Music playback controls");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        notifManager.createNotificationChannel(ch);
    }

    @Override public IBinder onBind(Intent intent) { return binder; }

    @Override
    public void onDestroy() {
        super.onDestroy();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
    }
}
