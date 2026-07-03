"use client";

import { useState, useRef, useEffect } from "react";
import { VideoCard } from "./VideoCard";
import { SocialVideo } from "@/types/social";
import { Compass } from "lucide-react";

export function VideoFeed({
  initialVideos,
}: {
  initialVideos: SocialVideo[];
}) {
  const [videos] = useState<SocialVideo[]>(initialVideos);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-index"));
            setActiveIndex(index);
          }
        });
      },
      { threshold: 0.6 }
    );

    const children = container.querySelectorAll(".video-item");
    children.forEach((child) => observer.observe(child));

    return () => observer.disconnect();
  }, [videos]);

  if (videos.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-center">
        <div>
          <div className="w-20 h-20 rounded-full bg-melori-elevated flex items-center justify-center mx-auto mb-4">
            <Compass className="w-10 h-10 text-melori-muted" />
          </div>
          <h3 className="text-xl font-bold mb-2 text-white">No videos yet</h3>
          <p className="text-melori-muted">
            Artist videos will appear here as they are posted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-y-scroll video-snap hide-scrollbar"
    >
      {videos.map((video, index) => (
        <div
          key={video.id}
          data-index={index}
          className="video-item h-full w-full flex-shrink-0 relative"
        >
          <VideoCard video={video} isActive={index === activeIndex} />
        </div>
      ))}
    </div>
  );
}
