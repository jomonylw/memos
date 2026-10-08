import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Icon from "@/components/Icon";
import { Resource } from "@/types/proto/api/v2/resource_service";
import { getResourceUrl } from "@/utils/resource";
import showAudioTranscriptionDialog from "./AudioTranscriptionDialog";

interface Props {
  resource: Resource;
  className?: string;
}

const BAR_COUNT = 40;

const generateFallbackWaveform = (seedStr: string): number[] => {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const x = Math.sin(hash + i * 1.3) * 10000;
    const val = Math.abs(x - Math.floor(x));
    bars.push(Math.round((0.2 + val * 0.8) * 100) / 100);
  }
  return bars;
};

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || isNaN(seconds) || seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const SPEED_OPTIONS = [1.0, 1.25, 1.5, 2.0];

const VoiceMemoPlayer: React.FC<Props> = ({ resource, className }: Props) => {
  const resourceUrl = getResourceUrl(resource);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [waveform, setWaveform] = useState<number[]>(() => generateFallbackWaveform(resourceUrl));
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isDownloading) return;
    setIsDownloading(true);

    const filename = resource.filename || `voice-memo-${resource.id || Date.now()}.webm`;

    try {
      // 1. Fetch file as blob for direct client-side download to avoid browser inline playback
      const response = await fetch(resourceUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success("已开始下载音频");
    } catch (error) {
      console.warn("Direct blob download failed, falling back to download link", error);
      // Fallback: If CORS or other issue prevents fetching blob, trigger download with ?download=1
      const downloadUrl = resourceUrl.includes("?") ? `${resourceUrl}&download=1` : `${resourceUrl}?download=1`;
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setIsDownloading(false);
    }
  };

  const updateDurationSafely = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) {
      setDuration(d);
    } else if (d === Infinity) {
      audio.currentTime = 1e101;
      const handleTimeUpdateForInfinity = () => {
        audio.removeEventListener("timeupdate", handleTimeUpdateForInfinity);
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
        audio.currentTime = 0;
      };
      audio.addEventListener("timeupdate", handleTimeUpdateForInfinity);
    }
  };

  useEffect(() => {
    let isCancelled = false;
    const fetchAndExtractWaveform = async () => {
      try {
        const response = await fetch(resourceUrl);
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const audioCtx = new AudioCtx();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        if (!isCancelled && Number.isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
          setDuration(audioBuffer.duration);
        }

        const channelData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(channelData.length / BAR_COUNT);
        const rawBars: number[] = [];

        for (let i = 0; i < BAR_COUNT; i++) {
          const start = i * blockSize;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(channelData[start + j] || 0);
          }
          rawBars.push(sum / blockSize);
        }

        const max = Math.max(...rawBars, 0.01);
        const normalized = rawBars.map((val) => Math.max(0.18, Math.min(1.0, val / max)));
        if (!isCancelled) {
          setWaveform(normalized);
        }
        audioCtx.close();
      } catch {
        // Fallback already active
      }
    };

    fetchAndExtractWaveform();
    return () => {
      isCancelled = true;
    };
  }, [resourceUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  const handleCycleSpeed = () => {
    const nextIndex = (SPEED_OPTIONS.indexOf(playbackRate) + 1) % SPEED_OPTIONS.length;
    const newSpeed = SPEED_OPTIONS[nextIndex];
    setPlaybackRate(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!waveformRef.current || !audioRef.current || duration <= 0 || !Number.isFinite(duration)) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = ratio * duration;
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const progressRatio = duration > 0 && Number.isFinite(duration) ? currentTime / duration : 0;

  return (
    <div
      className={`relative w-full max-w-full my-1 p-2.5 sm:p-3 rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50/70 dark:bg-zinc-800/80 shadow-xs flex flex-col gap-2 select-none overflow-hidden box-border min-w-0 ${
        className || ""
      }`}
    >
      <audio
        ref={audioRef}
        src={resourceUrl}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            if (duration <= 0 || !Number.isFinite(duration)) {
              updateDurationSafely();
            }
          }
        }}
        onLoadedMetadata={updateDurationSafely}
        onDurationChange={updateDurationSafely}
        onCanPlay={updateDurationSafely}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Icon.Mic className="w-3.5 h-3.5 shrink-0 text-blue-500" />
          <span className="truncate font-medium text-xs min-w-0">{resource.filename || "Voice Memo"}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => showAudioTranscriptionDialog({ resource, memoId: resource.memoId })}
            className="flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100/80 px-2 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="转写为文字 (Deepgram Nova-3)"
          >
            <Icon.Sparkles className="w-3 h-3 shrink-0" />
            <span className="whitespace-nowrap">转写</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="hover:text-blue-600 dark:hover:text-blue-400 p-0.5 rounded transition-colors shrink-0 cursor-pointer disabled:opacity-50"
            title="下载音频"
          >
            {isDownloading ? (
              <Icon.Loader className="w-3.5 h-3.5 animate-spin text-blue-500" />
            ) : (
              <Icon.Download className="w-3.5 h-3.5 opacity-70 hover:opacity-100" />
            )}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 min-w-0 w-full">
        <button
          type="button"
          onClick={togglePlay}
          className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-xs transition-transform active:scale-95"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Icon.Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white" />
          ) : (
            <Icon.Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white ml-0.5" />
          )}
        </button>

        <div
          ref={waveformRef}
          onClick={handleSeek}
          className="flex-1 min-w-0 h-7 sm:h-8 flex items-center justify-between gap-[1px] sm:gap-[2px] cursor-pointer group py-1 overflow-hidden"
          role="slider"
          aria-valuenow={currentTime}
          aria-valuemax={duration}
          tabIndex={0}
        >
          {waveform.map((heightPercent, index) => {
            const barRatio = (index + 0.5) / BAR_COUNT;
            const isFilled = barRatio <= progressRatio;
            return (
              <span
                key={index}
                style={{ height: `${Math.round(heightPercent * 100)}%` }}
                className={`flex-1 min-w-[1px] max-w-[3px] sm:max-w-[4px] rounded-full transition-all duration-75 ${
                  isFilled ? "bg-blue-600 dark:bg-blue-500 group-hover:bg-blue-500" : "bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-400"
                }`}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleCycleSpeed}
          className="shrink-0 px-1.5 sm:px-2 py-0.5 rounded-full text-[11px] sm:text-xs font-semibold bg-zinc-200/80 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 transition-colors"
          title="Change playback speed"
        >
          {playbackRate}x
        </button>
      </div>

      <div className="flex justify-between items-center text-[11px] text-zinc-400 dark:text-zinc-500 font-mono px-0.5">
        <span>{formatTime(currentTime)}</span>
        <span>{duration > 0 && Number.isFinite(duration) ? formatTime(duration) : "--:--"}</span>
      </div>
    </div>
  );
};

export default VoiceMemoPlayer;
