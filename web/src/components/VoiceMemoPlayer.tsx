import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { Resource } from "@/types/proto/api/v2/resource_service";
import { getResourceUrl } from "@/utils/resource";

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
  if (isNaN(seconds) || seconds < 0) return "00:00";
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
    if (!waveformRef.current || !audioRef.current || duration === 0) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = ratio * duration;
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const progressRatio = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      className={`relative w-full max-w-md my-1.5 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50/70 dark:bg-zinc-800/80 shadow-xs flex flex-col gap-2 select-none ${
        className || ""
      }`}
    >
      <audio
        ref={audioRef}
        src={resourceUrl}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon.Mic className="w-3.5 h-3.5 shrink-0 text-blue-500" />
          <span className="truncate font-medium">{resource.filename || "Voice Memo"}</span>
        </div>
        <a
          href={resourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-blue-600 dark:hover:text-blue-400 p-0.5 rounded transition-colors"
          title="Download audio"
        >
          <Icon.Download className="w-3.5 h-3.5 opacity-70 hover:opacity-100" />
        </a>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="w-9 h-9 shrink-0 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-xs transition-transform active:scale-95"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Icon.Pause className="w-4 h-4 fill-white" /> : <Icon.Play className="w-4 h-4 fill-white ml-0.5" />}
        </button>

        <div
          ref={waveformRef}
          onClick={handleSeek}
          className="flex-1 h-8 flex items-center gap-[3px] cursor-pointer group py-1"
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
                className={`w-[3px] rounded-full transition-all duration-75 ${
                  isFilled ? "bg-blue-600 dark:bg-blue-500 group-hover:bg-blue-500" : "bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-400"
                }`}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleCycleSpeed}
          className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-200/80 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 transition-colors"
          title="Change playback speed"
        >
          {playbackRate}x
        </button>
      </div>

      <div className="flex justify-between items-center text-[11px] text-zinc-400 dark:text-zinc-500 font-mono px-0.5">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};

export default VoiceMemoPlayer;
