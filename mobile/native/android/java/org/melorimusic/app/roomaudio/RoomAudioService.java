package org.melorimusic.app.roomaudio;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import org.melorimusic.app.R;

/**
 * Keeps the Melori process (and with it the WebView's LiveKit/WebRTC audio)
 * alive while the user is in a live room and the app is backgrounded or the
 * screen is locked.
 *
 * Source of truth lives in the repo at mobile/native/android/ and is copied
 * into the generated project by mobile/scripts/configure-android.sh, which
 * also declares this service in the manifest with
 * foregroundServiceType="microphone|mediaPlayback".
 *
 * Type rules (Android 14+ enforces them, older versions are lenient):
 *  - mediaPlayback is always claimed: listeners only need playback.
 *  - microphone is added only when the page asked for it AND RECORD_AUDIO is
 *    actually granted. Claiming it without the permission throws a
 *    SecurityException, and a service started with startForegroundService()
 *    that never reaches startForeground() crashes the whole app.
 *  - A microphone FGS cannot be started from the background, so the plugin
 *    only *starts* this service while the activity is visible; later mode
 *    changes are applied in place via {@link #apply}, never by restarting.
 */
public class RoomAudioService extends Service {

    static final String TAG = "MeloriRoomAudio";
    static final String CHANNEL_ID = "melori_live_room";
    static final int NOTIFICATION_ID = 7301;
    static final String ACTION_LEAVE = "org.melorimusic.app.roomaudio.LEAVE";
    static final String EXTRA_MICROPHONE = "microphone";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_LEAVE_ACTION = "leaveAction";
    static final String DEFAULT_TITLE = "Melori — in a live room";
    static final String DEFAULT_BODY = "Tap to return to the room.";

    /** Safety net so a leaked wake lock can never outlive a very long room. */
    private static final long WAKE_LOCK_TIMEOUT_MS = 6L * 60L * 60L * 1000L;
    /** If the page never answers a notification "Leave", stop on our own. */
    private static final long LEAVE_FALLBACK_MS = 10_000L;

    @Nullable
    private static volatile RoomAudioService current;

    @Nullable
    private PowerManager.WakeLock wakeLock;

    private boolean inForeground;
    private boolean microphoneActive;
    private final Handler handler = new Handler(Looper.getMainLooper());

    static boolean isRunning() {
        return current != null;
    }

    @Nullable
    static RoomAudioService getCurrent() {
        return current;
    }

    static boolean hasRecordAudio(Context context) {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        current = this;
        ensureChannel();
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && ACTION_LEAVE.equals(intent.getAction())) {
            boolean delivered = MeloriRoomAudioPlugin.notifyLeaveRequested();
            if (!delivered) {
                stopSelf();
            } else {
                handler.postDelayed(this::stopSelf, LEAVE_FALLBACK_MS);
            }
            return START_NOT_STICKY;
        }

        boolean wantMic = intent != null && intent.getBooleanExtra(EXTRA_MICROPHONE, false);
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String body = intent != null ? intent.getStringExtra(EXTRA_BODY) : null;
        boolean leaveAction = intent != null && intent.getBooleanExtra(EXTRA_LEAVE_ACTION, false);
        apply(wantMic, title, body, leaveAction);
        if (!inForeground) {
            // startForeground was refused outright. Stop rather than linger as a
            // started-but-not-foreground service.
            stopSelf();
        }
        // NOT sticky: if the process dies the LiveKit connection died with it,
        // so a restarted service would keep an empty notification alive.
        return START_NOT_STICKY;
    }

    /**
     * Enter (or re-enter) the foreground with the requested type. Safe to call
     * repeatedly on a running service: Android allows startForeground() again
     * to change the type and notification in place.
     *
     * @return true when the microphone type is active after the call.
     */
    synchronized boolean apply(boolean wantMicrophone, @Nullable String title, @Nullable String body, boolean leaveAction) {
        Notification notification = buildNotification(title, body, leaveAction);
        boolean mic = wantMicrophone && hasRecordAudio(this);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int playback = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
            int type = mic ? (playback | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) : playback;
            try {
                startForeground(NOTIFICATION_ID, notification, type);
                inForeground = true;
            } catch (RuntimeException micError) {
                // SecurityException (permission / while-in-use restriction) or
                // ForegroundServiceStartNotAllowedException. Fall back to
                // playback so listening at least keeps working.
                Log.w(TAG, "startForeground(" + type + ") refused, falling back to mediaPlayback", micError);
                mic = false;
                try {
                    startForeground(NOTIFICATION_ID, notification, playback);
                    inForeground = true;
                } catch (RuntimeException playbackError) {
                    Log.e(TAG, "startForeground(mediaPlayback) refused", playbackError);
                }
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                inForeground = true;
            } catch (RuntimeException e) {
                Log.e(TAG, "startForeground refused", e);
            }
            // API 29 has no microphone type and no while-in-use mic restriction.
        } else {
            try {
                startForeground(NOTIFICATION_ID, notification);
                inForeground = true;
            } catch (RuntimeException e) {
                Log.e(TAG, "startForeground refused", e);
            }
        }

        microphoneActive = mic && inForeground;
        return microphoneActive;
    }

    boolean isMicrophoneActive() {
        return microphoneActive;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping the app away from Recents ends the WebView and the room with
        // it; do not leave an orphaned "in a live room" notification behind.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        releaseWakeLock();
        inForeground = false;
        microphoneActive = false;
        if (current == this) {
            current = null;
        }
        super.onDestroy();
    }

    private Notification buildNotification(@Nullable String title, @Nullable String body, boolean leaveAction) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        builder
            .setSmallIcon(R.drawable.ic_stat_melori_live)
            .setContentTitle(title != null && !title.isEmpty() ? title : DEFAULT_TITLE)
            .setContentText(body != null && !body.isEmpty() ? body : DEFAULT_BODY)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_CALL);

        // Tapping the notification returns to the room (the activity is
        // singleTask, so this resumes the existing WebView, it does not reload).
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }

        // "Leave room" only when the page has a leave flow to run (a Faces host
        // ending the broadcast from the shade would be a surprise, so the page
        // omits it there).
        if (leaveAction && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent leave = new Intent(this, RoomAudioService.class).setAction(ACTION_LEAVE);
            PendingIntent leavePending = PendingIntent.getService(this, 1, leave, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.addAction(new Notification.Action.Builder(null, "Leave room", leavePending).build());
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Show the notification immediately instead of after the 10s grace.
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        // LOW: visible in the shade and on the lock screen, but no sound or
        // heads-up every time someone joins a room.
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Live rooms", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while you are in a live room so audio keeps playing with the screen off.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        if (wakeLock != null) {
            return;
        }
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) {
                return;
            }
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Melori::LiveRoom");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        } catch (RuntimeException e) {
            Log.w(TAG, "wake lock unavailable", e);
            wakeLock = null;
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (RuntimeException ignored) {
            // already released by its timeout
        }
        wakeLock = null;
    }
}
