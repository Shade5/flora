// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Immutable, PanelExtensionContext } from "@lichtblick/suite";

// Define the time interface
interface Time {
  sec: number;
  nsec: number;
}

function VideoPanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const [currentTime, setCurrentTime] = useState<Immutable<Time | undefined>>();
  const [videoTimestamp, setVideoTimestamp] = useState<number>(0);
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [videoOffset, setVideoOffset] = useState<bigint | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const log_name = context.dsUrl?.match(/ailog_([A-Z0-9-]+)_(\d{4}_\d{2}_\d{2}-\d{2}_\d{2}_\d{2})/)?.[0] ?? "";
  const [invalidPts, setInvalidPts] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastTimeRef = useRef<bigint | null>(null);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Video source URL base path
  const basePath = `http://comino1:8000/ai_logs/${log_name}`;
  const videoUrl = `${basePath}/video_preview.mp4`;
  const audioUrl = `${basePath}/video.robot.ogg`;
  const timestampUrl = `${basePath}/video.timestamp`;

  useEffect(() => {
    if (!log_name.trim()) return;
    fetch(timestampUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Failed to fetch timestamp: ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (data.video_start_pts) {
          setVideoOffset(BigInt(data.video_start_pts));
        } else {
          throw new Error("Missing video_start_pts in timestamp file");
        }
      })
      .catch(error => console.error("Error loading timestamp:", error));
  }, [timestampUrl, log_name]);

  // ensure /video/pts is registered in the pipeline
  useEffect(() => { context.watch("/video/pts"); }, [context]);

  useLayoutEffect(() => {
    context.onRender = (renderState: any, done: () => void) => {
      setRenderDone(() => done);
      if (renderState.currentTime) {
        const currentTimeNs = BigInt(renderState.currentTime.sec) * BigInt(1_000_000_000) + BigInt(renderState.currentTime.nsec);
        if (!lastTimeRef.current || currentTimeNs !== lastTimeRef.current) {
          setCurrentTime(renderState.currentTime);
          if (lastTimeRef.current !== null) {
            const timeDiffNs = Number(currentTimeNs - lastTimeRef.current);
            const isTimelineMoving = timeDiffNs > 0 && timeDiffNs < 500_000_000;
            setIsPlaying(isTimelineMoving);
          }
          lastTimeRef.current = currentTimeNs;
          if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
          seekTimeoutRef.current = setTimeout(() => setIsPlaying(false), 300);
        }
      }
    };
    context.watch("currentTime");
    return () => { if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current); };
  }, [context]);

  useEffect(() => { renderDone?.(); }, [renderDone]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    const handleTimeUpdate = () => {
      setVideoTimestamp(video.currentTime);
      // publish PTS as Float64 using base context
      context.publish?.("/video/pts", { data: Math.floor(video.currentTime * 1e9) });
      if (Math.abs(audio.currentTime - video.currentTime) > 0.2) {
        audio.currentTime = video.currentTime;
      }
    };
    if ('preservesPitch' in audio) { audio.preservesPitch = false; }
    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => { video.removeEventListener('timeupdate', handleTimeUpdate); };
  }, [context]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!currentTime || !video || !audio || videoOffset === null) return;
    const mcapTimeInNs = BigInt(currentTime.sec) * BigInt(1_000_000_000) + BigInt(currentTime.nsec);
    const targetVideoTimeNs = mcapTimeInNs - videoOffset;
    const targetVideoTimeSec = Number(targetVideoTimeNs) / 1_000_000_000;
    if (targetVideoTimeNs <= 0n) {
      setInvalidPts(true);
      video.pause();
      audio.pause();
      return;
    } else {
      setInvalidPts(false);
    }
    if (Math.abs(video.currentTime - targetVideoTimeSec) > 0.1 && video.readyState >= 2) {
      video.currentTime = targetVideoTimeSec;
      audio.currentTime = targetVideoTimeSec;
    }
    if (isPlaying && video.paused) {
      Promise.all([
        video.play().catch(err => console.warn("Video play error:", err)),
        audio.play().catch(err => console.warn("Audio play error:", err))
      ]).catch(() => console.warn("Media playback blocked"));
    } else if (!isPlaying && !video.paused) {
      video.pause();
      audio.pause();
    }
  }, [currentTime, videoOffset, isPlaying]);

  const mcapTimeInNs = currentTime
    ? BigInt(currentTime.sec) * BigInt(1_000_000_000) + BigInt(currentTime.nsec)
    : null;

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const loadVideoWithCurrentLogName = () => {
    if (!log_name.trim()) return;
    setVideoOffset(null);
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video && audio) {
      video.pause();
      audio.pause();
      const videoSource = video.querySelector('source');
      const audioSource = audio.querySelector('source');
      if (videoSource && audioSource) {
        videoSource.src = `${basePath}/video_preview.mp4`;
        audioSource.src = `${basePath}/video.robot.ogg`;
        video.load();
        audio.load();
      }
    }
    fetch(timestampUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Failed to fetch timestamp: ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (data.video_start_pts) {
          setVideoOffset(BigInt(data.video_start_pts));
        } else {
          throw new Error("Missing video_start_pts in timestamp file");
        }
      })
      .catch(error => console.error("Error loading timestamp:", error));
  };

  useEffect(() => { if (log_name.trim()) loadVideoWithCurrentLogName(); }, [log_name]);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 0, margin: 0, overflow: "hidden"}}>
      <div style={{ padding: "8px", display: "flex", justifyContent: "space-between", backgroundColor: "#333", color: "#fff", borderBottom: "1px solid #222"}}>
        <div style={{ fontSize: "14px", fontFamily: "monospace", color: "#fff"}}>
          <b>MCAP Time (ns):</b> {mcapTimeInNs !== null ? mcapTimeInNs.toString() : "Waiting..."}
        </div>
        <div style={{ fontSize: "14px", fontFamily: "monospace", color: "#fff"}}>
          <b>Video PTS:</b> {formatTime(videoTimestamp)}{isPlaying && <span style={{ marginLeft: "10px", color: "#4CAF50"}}>● Playing</span>}
        </div>
      </div>
      <div style={{ flex: 1, width: "100%", position: "relative", backgroundColor: "#000" }}>
        {invalidPts && <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0, 0, 0, 0.5)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1}}>
          <span style={{ fontSize: "18px", fontWeight: "bold"}}>Warning: PTS ≤ 0, seek forward</span>
        </div>}
        <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "contain"}} preload="auto">
          {log_name.trim() && <source src={videoUrl} type="video/mp4" />}
          Your browser does not support the video tag.
        </video>
        <audio ref={audioRef} preload="auto" style={{ display: "none"}}>
          {log_name.trim() && <source src={audioUrl} type="audio/ogg" />}
          Your browser does not support the audio element.
        </audio>
      </div>
    </div>
  );
}

export default VideoPanel;
