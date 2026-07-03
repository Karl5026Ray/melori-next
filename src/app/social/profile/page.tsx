"use client";

import { useAuth } from "@/components/social/providers/AuthProvider";
import { Radio } from "lucide-react";

export default function ProfilePage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-melori-muted">Sign in to view your profile</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto animate-fade-in">
      <div className="relative h-48 md:h-64 bg-gradient-to-br from-melori-purple/20 to-melori-pink/20">
        <div className="absolute inset-0 bg-melori-void/20" />
      </div>

      <div className="max-w-3xl mx-auto px-4 md:px-8 -mt-16 relative z-10 pb-24 md:pb-8">
        <div className="flex flex-col md:flex-row items-start md:items-end gap-4 mb-6">
          <div className="relative">
            <img
              src={user.avatar_url || "/favicon.png"}
              className="w-32 h-32 rounded-full border-4 border-melori-void object-cover"
              alt={user.display_name}
            />
          </div>
          <div className="flex-1 mb-2">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-bold">{user.display_name}</h2>
              {user.verified && (
                <span className="text-melori-purple bg-melori-purple/10 px-2 py-0.5 rounded-full text-xs font-medium">
                  Verified
                </span>
              )}
            </div>
            <p className="text-melori-purple font-medium text-sm mb-1 capitalize">
              {user.role}
            </p>
            <p className="text-melori-muted text-sm">
              {user.bio || "Independent music advocate"}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="px-6 py-2.5 rounded-full bg-melori-elevated border border-melori-border font-medium text-sm hover:bg-melori-purple/10 hover:border-melori-purple/30 transition">
              Edit Profile
            </button>
          </div>
        </div>

        <div className="flex gap-6 mb-8 text-sm">
          <div>
            <span className="font-bold text-melori-text">
              {user.followers_count}
            </span>{" "}
            <span className="text-melori-muted">Followers</span>
          </div>
          <div>
            <span className="font-bold text-melori-text">
              {user.following_count}
            </span>{" "}
            <span className="text-melori-muted">Following</span>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 mb-6">
          <h3 className="font-bold mb-4">Stats</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-melori-void/50 rounded-xl">
              <p className="text-2xl font-bold gradient-text">0</p>
              <p className="text-xs text-melori-muted mt-1">Spaces Hosted</p>
            </div>
            <div className="text-center p-4 bg-melori-void/50 rounded-xl">
              <p className="text-2xl font-bold gradient-text">0</p>
              <p className="text-xs text-melori-muted mt-1">Spaces Joined</p>
            </div>
            <div className="text-center p-4 bg-melori-void/50 rounded-xl">
              <p className="text-2xl font-bold gradient-text">0</p>
              <p className="text-xs text-melori-muted mt-1">Messages</p>
            </div>
            <div className="text-center p-4 bg-melori-void/50 rounded-xl">
              <p className="text-2xl font-bold gradient-text">0</p>
              <p className="text-xs text-melori-muted mt-1">Videos</p>
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <h3 className="font-bold mb-4">Recent Activity</h3>
          <div className="text-center py-12 text-melori-muted">
            <Radio className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No activity yet. Start exploring Spaces!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
