package org.melorimusic.app.roomaudio;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;

/**
 * JS bridge for {@link RoomAudioService}. Registered in MainActivity by
 * mobile/scripts/configure-android.sh and reached from melorimusic.org through
 * registerPlugin("MeloriRoomAudio") in src/lib/native/roomBackground.ts.
 *
 * Every method resolves rather than rejects where it can: the page treats this
 * as an enhancement and must keep working when it is unavailable.
 */
@CapacitorPlugin(
    name = "MeloriRoomAudio",
    permissions = {
        @Permission(alias = MeloriRoomAudioPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = MeloriRoomAudioPlugin.BLUETOOTH, strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class MeloriRoomAudioPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";
    static final String BLUETOOTH = "bluetooth";
    static final String LEAVE_EVENT = "leaveRequested";

    @Nullable
    private static volatile MeloriRoomAudioPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }
    }

    /** Called by the service when the notification's "Leave room" is tapped. */
    static boolean notifyLeaveRequested() {
        MeloriRoomAudioPlugin plugin = instance;
        if (plugin == null || !plugin.hasListeners(LEAVE_EVENT)) {
            return false;
        }
        plugin.notifyListeners(LEAVE_EVENT, new JSObject());
        return true;
    }

    /**
     * Ask for POST_NOTIFICATIONS (Android 13+) and BLUETOOTH_CONNECT (Android
     * 12+) — at room join, never at launch. Only aliases that are runtime
     * permissions on this OS version and not yet granted are requested.
     */
    @PluginMethod
    public void requestRoomPermissions(PluginCall call) {
        List<String> aliases = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
            aliases.add(NOTIFICATIONS);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState(BLUETOOTH) != PermissionState.GRANTED) {
            aliases.add(BLUETOOTH);
        }
        if (aliases.isEmpty()) {
            call.resolve(permissionResult());
            return;
        }
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "roomPermissionsCallback");
    }

    @PermissionCallback
    private void roomPermissionsCallback(PluginCall call) {
        call.resolve(permissionResult());
    }

    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put(
            NOTIFICATIONS,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? getPermissionState(NOTIFICATIONS).toString() : "granted"
        );
        result.put(BLUETOOTH, Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? getPermissionState(BLUETOOTH).toString() : "granted");
        return result;
    }

    /**
     * Start the service, or update it in place if already running.
     * options: { mode: "microphone" | "playback", title?, body?, leaveAction? }
     * resolves: { running: boolean, mode: "microphone" | "playback" | "none", reason? }
     */
    @PluginMethod
    public void start(PluginCall call) {
        boolean wantMic = "microphone".equals(call.getString("mode", "playback"));
        String title = call.getString("title");
        String body = call.getString("body");
        boolean leaveAction = Boolean.TRUE.equals(call.getBoolean("leaveAction", false));
        Context context = getContext();

        RoomAudioService running = RoomAudioService.getCurrent();
        if (running != null) {
            boolean mic = running.apply(wantMic, title, body, leaveAction);
            call.resolve(result(true, mic ? "microphone" : "playback", null));
            return;
        }

        // Starting a foreground service from the background is refused on
        // Android 12+, and a microphone one on 14+ even with an exemption. Only
        // start while the room is on screen; the page retries when it returns.
        if (!isActivityVisible()) {
            call.resolve(result(false, "none", "background"));
            return;
        }

        Intent intent = new Intent(context, RoomAudioService.class);
        intent.putExtra(RoomAudioService.EXTRA_MICROPHONE, wantMic);
        intent.putExtra(RoomAudioService.EXTRA_TITLE, title);
        intent.putExtra(RoomAudioService.EXTRA_BODY, body);
        intent.putExtra(RoomAudioService.EXTRA_LEAVE_ACTION, leaveAction);
        try {
            ContextCompat.startForegroundService(context, intent);
        } catch (RuntimeException e) {
            call.resolve(result(false, "none", e.getClass().getSimpleName()));
            return;
        }
        boolean mic = wantMic && RoomAudioService.hasRecordAudio(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
        call.resolve(result(true, mic ? "microphone" : "playback", null));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Context context = getContext();
            context.stopService(new Intent(context, RoomAudioService.class));
        } catch (RuntimeException ignored) {
            // nothing running
        }
        call.resolve(result(false, "none", null));
    }

    private boolean isActivityVisible() {
        Activity activity = getActivity();
        if (activity instanceof AppCompatActivity) {
            return ((AppCompatActivity) activity).getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED);
        }
        return activity != null && !activity.isFinishing();
    }

    private static JSObject result(boolean running, String mode, @Nullable String reason) {
        JSObject r = new JSObject();
        r.put("running", running);
        r.put("mode", mode);
        if (reason != null) {
            r.put("reason", reason);
        }
        return r;
    }
}
