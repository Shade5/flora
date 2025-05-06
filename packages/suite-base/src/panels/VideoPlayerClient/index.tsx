import { Box, Typography } from "@mui/material";
import { ReactElement, useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";

import Panel from "../../components/Panel";
import PanelToolbar from "../../components/PanelToolbar";
import {
    MessagePipelineContext,
    useMessagePipeline,
} from "../../components/MessagePipeline";
import usePublisher from "@lichtblick/suite-base/hooks/usePublisher";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import { PanelConfig, SaveConfig } from "@lichtblick/suite-base/types/panels";
import { windowAppURLState } from "@lichtblick/suite-base/util/appURLState";
import { RawImage } from "@foxglove/schemas/schemas/typescript/RawImage";
import { MessageDefinition } from "@foxglove/message-definition";
import { Immutable } from "@lichtblick/suite";
import CommonRosTypes from "@lichtblick/rosmsg-msgs-common";

// Define the Time interface locally
interface Time {
    sec: number;
    nsec: number;
}

// Define the selectors for the state we need from the message pipeline
const selectCurrentTime = (ctx: MessagePipelineContext): Time | undefined =>
    ctx.playerState.activeData?.currentTime;
const selectIsPlaying = (ctx: MessagePipelineContext) =>
    ctx.playerState.activeData?.isPlaying ?? false;
// Selector for the data source profile
const selectDataSourceProfile = (ctx: MessagePipelineContext): string | undefined =>
    ctx.playerState.profile; // Assuming profile exists here

const PUBLISH_TOPIC = "/video_player/frame";
const PUBLISHER_NAME = "VideoPlayerClient"; // Optional name for the publisher

// This component contains the core logic adapted from your extension
function VideoPlayerPanelInner(): ReactElement {
    // Get state from the message pipeline
    const currentTime = useMessagePipeline(selectCurrentTime);
    const isPlaying = useMessagePipeline(selectIsPlaying);
    const dataSourceProfile = useMessagePipeline(selectDataSourceProfile); // Get profile here
    // Get data source info (without profile)
    const { datatypes: dataSourceDatatypes, capabilities } = useDataSourceInfo();
    // Attempt to get the data source URL from the window/app state
    const dsUrl = windowAppURLState()?.dsParams?.url;

    // Log capabilities and profile on mount/change
    useEffect(() => {
        console.log("VideoPlayerClient: Capabilities:", capabilities);
        console.log("VideoPlayerClient: Profile:", dataSourceProfile);
    }, [capabilities, dataSourceProfile]);

    // --- Merge datatypes ---
    const mergedDatatypes = useMemo(() => {
        // Explicitly define the keys we expect for common types
        const commonTypesMap: { [key: string]: Record<string, MessageDefinition> } = {
            ros1: CommonRosTypes.ros1,
            ros2: CommonRosTypes.ros2galactic, // Adjust if needed (e.g., ros2humble)
        };

        // Safely get the common types based on the profile
        const commonTypes = dataSourceProfile ? commonTypesMap[dataSourceProfile] : undefined;

        const baseDatatypes = dataSourceDatatypes ?? new Map(); // Ensure we have a Map

        if (commonTypes == undefined) {
            return baseDatatypes; // Return source types if no matching common set
        }

        // Merge: Source datatypes take precedence over common types if names clash
        return new Map<string, Immutable<MessageDefinition>>([
            ...Object.entries(commonTypes),
            ...baseDatatypes, // Spread the map entries
        ]);
    }, [dataSourceProfile, dataSourceDatatypes]);

    // Log the final datatypes map and check for RawImage
    useEffect(() => {
        console.log("VideoPlayerClient: Merged Datatypes:", mergedDatatypes);
        console.log("VideoPlayerClient: Does merged map have RawImage?", mergedDatatypes.has("RawImage"));
    }, [mergedDatatypes]);
    // --- End Merge datatypes ---

    // Use the dedicated usePublisher hook with the *merged* datatypes
    const publish = usePublisher({
        name: PUBLISHER_NAME,
        topic: PUBLISH_TOPIC,
        schemaName: "sensor_msgs/Image",
        datatypes: mergedDatatypes,
    });

    // Local state for the video player
    const [videoTimestamp, setVideoTimestamp] = useState<number>(0);
    const [videoOffset, setVideoOffset] = useState<bigint | null>(null);
    const [invalidPts, setInvalidPts] = useState<boolean>(false);

    // Refs for media elements and state tracking
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const lastPublishTimeRef = useRef<Time | null>(null); // Correct ref for last published frame time
    const lastMcapTimeNsRef = useRef<bigint | null>(null); // Correct ref for tracking MCAP time changes (was lastTimeRef)
    const isPlayingStable = useRef<boolean>(false);
    const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Derive log_name and media paths from the dsUrl
    // Update this regex if your URL pattern is different
    const log_name = dsUrl?.match(/ailog_([A-Z0-9-]+)_(\d{4}_\d{2}_\d{2}-\d{2}_\d{2}_\d{2})/)?.[0] ?? "";
    // Consider making this base path configurable in panel settings later
    const basePath = `http://comino1:8000/ai_logs/${log_name}`;
    const videoUrl = `${basePath}/video_preview.mp4`;
    const audioUrl = `${basePath}/video.robot.ogg`;
    const timestampUrl = `${basePath}/video.timestamp`;

    // Effect to fetch video timestamp when the source changes
    useEffect(() => {
        // Don't fetch if we couldn't derive a log name
        if (!log_name.trim()) {
            setVideoOffset(null); // Ensure offset is reset if no valid source
            return;
        }
        setVideoOffset(null); // Reset offset before fetching new one

        let didCancel = false;
        fetch(timestampUrl)
            .then((response) => {
                if (!response.ok)
                    throw new Error(`Timestamp fetch failed: ${response.status} ${response.statusText}`);
                return response.json();
            })
            .then((data) => {
                if (!didCancel) {
                    if (data.video_start_pts != null) {
                        setVideoOffset(BigInt(data.video_start_pts));
                    } else {
                        console.error("Missing video_start_pts in timestamp file:", timestampUrl);
                        setVideoOffset(null); // Explicitly set null if missing
                    }
                }
            })
            .catch((error) => {
                if (!didCancel) {
                    console.error("Error loading timestamp:", timestampUrl, error);
                    setVideoOffset(null); // Explicitly set null on error
                }
            });

        // Cleanup function to prevent state updates if the component unmounts
        // or if the timestampUrl changes before the fetch completes.
        return () => {
            didCancel = true;
        };
    }, [timestampUrl, log_name]); // Re-fetch if the timestamp URL or log name changes

    // Effect to manage stable playing state based on pipeline state and seek timeout
    useEffect(() => {
        if (currentTime) {
            const currentTimeNs = BigInt(currentTime.sec) * BigInt(1_000_000_000) + BigInt(currentTime.nsec);
            lastMcapTimeNsRef.current = currentTimeNs; // Update the correct ref
        }

        isPlayingStable.current = isPlaying;
        if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
        if (!isPlaying) {
            // Add a small delay before setting stable state to false, allowing seeks to complete
            seekTimeoutRef.current = setTimeout(() => {
                isPlayingStable.current = false;
            }, 300);
        }
        // Cleanup timeout on unmount or if dependencies change
        return () => {
            if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
        };
    }, [currentTime, isPlaying]);

    // Effect to setup media element listeners and properties
    useEffect(() => {
        const video = videoRef.current;
        const audio = audioRef.current;
        if (!video || !audio) return;

        const handleTimeUpdate = () => {
            setVideoTimestamp(video.currentTime);
            // Sync audio to video if needed and possible
            if (audio.readyState >= 2 && Math.abs(audio.currentTime - video.currentTime) > 0.2) {
                try { audio.currentTime = video.currentTime; } catch (e) { /* Ignore sync error */ }
            }
        };

        // Try to disable pitch correction for potentially smoother playback speed changes
        if ('preservesPitch' in audio) {
            try { (audio as any).preservesPitch = false; } catch (e) { /* Ignore */ }
        }

        video.addEventListener('timeupdate', handleTimeUpdate);

        // Cleanup listener on unmount
        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
        };
    }, []); // Run once on mount

    // Effect to handle seeking and play/pause state changes
    useEffect(() => {
        const video = videoRef.current;
        const audio = audioRef.current;
        // Ensure all required data and elements are available
        if (!currentTime || !video || !audio || videoOffset === null) return;

        // Calculate target video time based on MCAP time and offset
        const mcapTimeInNs = BigInt(currentTime.sec) * BigInt(1_000_000_000) + BigInt(currentTime.nsec);
        const targetVideoTimeNs = mcapTimeInNs - videoOffset;
        const targetVideoTimeSec = Number(targetVideoTimeNs) / 1_000_000_000;

        // Handle cases where the calculated time is before the video starts
        if (targetVideoTimeNs <= 0n) {
            setInvalidPts(true);
            if (!video.paused) { video.pause(); }
            if (!audio.paused) { audio.pause(); }
            return; // Don't proceed with seek/play
        } else {
            setInvalidPts(false);
        }

        // Seek the video if necessary (significant difference or trying to play while paused)
        if (video.readyState >= video.HAVE_METADATA) {
            const timeDiff = Math.abs(video.currentTime - targetVideoTimeSec);
            // Seek tolerance: 0.2s. Also seek if playing but video is paused (e.g., after buffer)
            if (timeDiff > 0.2 || (isPlayingStable.current && video.paused)) {
                try {
                    video.currentTime = targetVideoTimeSec;
                    if (audio.readyState >= audio.HAVE_METADATA) {
                        audio.currentTime = targetVideoTimeSec;
                    }
                } catch (e) { console.warn("Video/Audio seek error:", e); }
            }
        }

        // Synchronize play/pause state with the stable playing state
        // Check readyState before attempting play to avoid errors
        if (isPlayingStable.current && video.paused && video.readyState >= video.HAVE_ENOUGH_DATA && audio.readyState >= audio.HAVE_ENOUGH_DATA) {
            // Use a void operator to explicitly ignore the promise, as we handle errors internally
            void Promise.all([
                video.play().catch(err => console.warn("Video play error:", err)),
                audio.play().catch(err => console.warn("Audio play error:", err))
            ]).catch(() => { /* Already logged warnings */ });
        } else if (!isPlayingStable.current && !video.paused) {
            video.pause();
            audio.pause();
        }
    }, [currentTime, videoOffset, isPlayingStable.current]); // React to MCAP time, offset, and stable playing state

    // Effect to load media sources when the derived URLs change
    useEffect(() => {
        // Don't try to load if log_name is invalid
        if (!log_name.trim()) return;

        const video = videoRef.current;
        const audio = audioRef.current;

        if (video && audio) {
            video.pause();
            audio.pause();
            // Set the new sources
            video.src = videoUrl;
            audio.src = audioUrl;
            // Important: Call load() to make the browser fetch the new sources
            video.load();
            audio.load();
        }
    }, [log_name, videoUrl, audioUrl]); // Reload when log_name or derived URLs change

    // --- Frame Publishing Logic ---
    const publishFrame = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const currentFrameTime = currentTime;

        if (!video || !canvas || !currentFrameTime || video.paused || video.readyState < video.HAVE_CURRENT_DATA) {
            return;
        }
        // Avoid publishing exact same time again
        if (lastPublishTimeRef.current &&
            lastPublishTimeRef.current.sec === currentFrameTime.sec &&
            lastPublishTimeRef.current.nsec === currentFrameTime.nsec) {
            return;
        }

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { return; }

        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        if (canvas.width !== videoWidth) canvas.width = videoWidth;
        if (canvas.height !== videoHeight) canvas.height = videoHeight;

        ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
        const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight);

        const imageMessage: RawImage = {
            timestamp: currentFrameTime,
            frame_id: "video_frame",
            width: videoWidth,
            height: videoHeight,
            encoding: "rgba8",
            step: videoWidth * 4,
            data: new Uint8Array(imageData.data.buffer),
        };

        // Call publish with the typed message object
        publish(imageMessage);
        lastPublishTimeRef.current = currentFrameTime;

    }, [publish, currentTime]); // Dependencies

    // --- Use video timeupdate for triggering frame publish ---
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Use a separate handler for publishing to potentially throttle later
        const handleTimeUpdateForPublish = () => {
            // Maybe add throttling here if performance becomes an issue
            publishFrame();
        };

        video.addEventListener('timeupdate', handleTimeUpdateForPublish);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdateForPublish);
        };
    }, [publishFrame]); // Re-attach listener if publishFrame changes

    // Helper function to format time display
    const formatTime = (seconds: number): string => {
        if (isNaN(seconds) || seconds < 0) return "00:00:00.000";
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    };

    // Calculate display time in nanoseconds
    const mcapTimeInNs = currentTime
        ? BigInt(currentTime.sec) * BigInt(1_000_000_000) + BigInt(currentTime.nsec)
        : null;

    // Render the panel UI
    return (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", overflow: "hidden" }}>
            {/* Standard panel toolbar */}
            <PanelToolbar />

            {/* Custom info bar */}
            <div style={{ padding: "8px", display: "flex", justifyContent: "space-between", backgroundColor: "#333", color: "#fff", borderBottom: "1px solid #222", flexShrink: 0 }}>
                <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#fff" }}>
                    <b>MCAP Time (ns):</b> {mcapTimeInNs !== null ? mcapTimeInNs.toString() : "Waiting..."}
                </div>
                <div style={{ fontSize: "12px", fontFamily: "monospace", color: "#fff" }}>
                    <b>Video PTS:</b> {formatTime(videoTimestamp)}
                    {isPlaying && <span style={{ marginLeft: "10px", color: "#4CAF50" }}>● Playing</span>}
                </div>
            </div>

            {/* Main video area */}
            <div style={{ flex: 1, width: "100%", position: "relative", backgroundColor: "#000", overflow: "hidden" }}>
                {/* Conditional overlays for different states */}
                {!log_name.trim() && (
                    <Box display="flex" alignItems="center" justifyContent="center" height="100%" color="grey.500">
                        <Typography>No compatible data source detected.</Typography>
                    </Box>
                )}
                {log_name.trim() && videoOffset === null && !invalidPts && (
                    <Box display="flex" alignItems="center" justifyContent="center" height="100%" color="grey.500">
                        <Typography>Loading video data...</Typography>
                    </Box>
                )}
                {invalidPts && (
                    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0, 0, 0, 0.7)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
                        <span style={{ fontSize: "18px", fontWeight: "bold" }}>Warning: Video PTS ≤ 0. Seek forward in timeline.</span>
                    </div>
                )}
                {/* Video element */}
                <video
                    ref={videoRef}
                    crossOrigin="anonymous"
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: log_name.trim() && videoOffset !== null ? 'block' : 'none' }}
                    preload="auto"
                    muted
                    playsInline
                >
                    Your browser does not support the video tag.
                </video>
                {/* Hidden audio element */}
                <audio
                    ref={audioRef}
                    preload="auto"
                    style={{ display: "none" }}
                >
                    Your browser does not support the audio element.
                </audio>
                {/* Hidden canvas for frame grabbing */}
                <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>
        </div>
    );
}

// Wrapper component provided to the Panel HOC
const VideoPlayerPanel = ({ config: _config, saveConfig: _saveConfig }: { config: PanelConfig; saveConfig: SaveConfig<PanelConfig> }) => {
    return <VideoPlayerPanelInner />;
};

// Panel metadata
VideoPlayerPanel.panelType = "VideoPlayerClient";
// Define default config - could hold base path or other settings later
VideoPlayerPanel.defaultConfig = {};

// Export the panel component wrapped in the Panel HOC
export default Panel(VideoPlayerPanel);
