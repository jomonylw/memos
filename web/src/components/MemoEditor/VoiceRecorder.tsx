import { IconButton } from "@mui/joy";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import showAudioTranscriptionDialog from "@/components/AudioTranscriptionDialog";
import Icon from "@/components/Icon";
import showMicrophoneGuideDialog from "@/components/MicrophoneGuideDialog";
import { checkMicrophoneSupport, getVoiceMemoSetting, transcribeAudioWithDeepgram } from "@/helpers/stt";
import { Resource } from "@/types/proto/api/v2/resource_service";

interface Props {
  onAudioRecorded: (file: File) => Promise<Resource | undefined>;
  onTranscribeText?: (text: string) => void;
}

const VoiceRecorder: React.FC<Props> = ({ onAudioRecorded, onTranscribeText }: Props) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startRecording = async () => {
    const supportCheck = checkMicrophoneSupport();
    if (!supportCheck.supported) {
      if (supportCheck.reason === "insecure-context") {
        showMicrophoneGuideDialog({ reason: "insecure-context" });
        return;
      }
      showMicrophoneGuideDialog({ reason: "unsupported-browser" });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error(err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        showMicrophoneGuideDialog({ reason: "permission-denied" });
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        showMicrophoneGuideDialog({ reason: "device-not-found" });
      } else {
        toast.error("无法访问麦克风: " + (err.message || "请检查浏览器设置"));
      }
    }
  };

  const cancelRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    setIsRecording(false);
    setIsProcessing(false);
    setRecordingSeconds(0);
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    if (timerRef.current) clearInterval(timerRef.current);

    const recorder = mediaRecorderRef.current;
    setIsRecording(false);
    setIsProcessing(true);

    recorder.onstop = async () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const mimeType = recorder.mimeType || "audio/webm";
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

      if (audioChunksRef.current.length === 0 || audioBlob.size === 0) {
        toast.error("录音内容为空，请重新录制");
        setIsProcessing(false);
        return;
      }

      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const filename = `voice-memo-${Date.now()}.${extension}`;
      const audioFile = new File([audioBlob], filename, { type: mimeType });

      try {
        const uploadPromise = onAudioRecorded(audioFile);
        const setting = getVoiceMemoSetting();
        let transcribePromise: Promise<string> = Promise.resolve("");
        let transcribeError: string | null = null;

        if (setting.deepgramApiKey) {
          transcribePromise = transcribeAudioWithDeepgram(audioBlob, {
            apiKey: setting.deepgramApiKey,
            model: setting.sttModel,
            language: setting.sttLanguage,
          }).catch((err: any) => {
            console.error("Deepgram 转写失败:", err);
            transcribeError = err.message || "Deepgram 转写未完成";
            return "";
          });
        } else {
          transcribeError = "未配置 Deepgram API Key";
        }

        const [uploadedResource, transcript] = await Promise.all([uploadPromise, transcribePromise]);
        if (transcript && onTranscribeText && setting.autoAppendToEditor) {
          onTranscribeText(transcript);
          toast.success("录音已保存并转写完成");
        } else if (transcript && onTranscribeText) {
          onTranscribeText(transcript);
          toast.success("录音已保存并转写完成");
        } else {
          if (transcribeError) {
            toast(
              (t) => (
                <div className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">录音已保存，但自动转写未完成</span>
                  <span className="text-zinc-500 dark:text-zinc-400">{transcribeError}</span>
                  {uploadedResource && (
                    <button
                      type="button"
                      onClick={() => {
                        toast.dismiss(t.id);
                        showAudioTranscriptionDialog({
                          resource: uploadedResource,
                          onTranscribeText,
                        });
                      }}
                      className="mt-1 px-2.5 py-1 rounded bg-blue-600 text-white font-medium text-center hover:bg-blue-700 active:scale-95 transition-all"
                    >
                      点击手动转写
                    </button>
                  )}
                </div>
              ),
              { duration: 6000 }
            );
          } else {
            toast.success("录音已保存至附件");
          }
        }
      } catch (err: any) {
        toast.error("录音保存失败: " + (err?.message || "未知错误"));
      } finally {
        setIsProcessing(false);
      }
    };

    recorder.stop();
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (isRecording) {
    return (
      <div className="flex items-center gap-2 sm:gap-3 px-3 py-1 rounded-full bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800/80 shadow-xs text-red-600 dark:text-red-300 select-none animate-in fade-in duration-150">
        <span className="relative flex h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 sm:h-3 sm:w-3 bg-red-500"></span>
        </span>
        <span className="font-mono text-xs sm:text-sm font-semibold tracking-wider text-red-600 dark:text-red-400">
          {formatSeconds(recordingSeconds)}
        </span>
        <div className="flex items-center gap-1.5 ml-1">
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center justify-center gap-1 h-7 sm:h-8 px-2.5 sm:px-3 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
            title="完成录音并转写"
          >
            <Icon.Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
            <span>完成</span>
          </button>
          <button
            type="button"
            onClick={cancelRecording}
            className="flex items-center justify-center gap-1 h-7 sm:h-8 px-2 sm:px-2.5 rounded-full bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 active:scale-95 text-zinc-600 dark:text-zinc-300 text-xs font-medium transition-all cursor-pointer"
            title="取消录音"
          >
            <Icon.X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">取消</span>
          </button>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/80 text-blue-600 dark:text-blue-400 text-xs font-medium select-none shadow-xs">
        <Icon.Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin text-blue-500" />
        <span>处理中...</span>
      </div>
    );
  }

  return (
    <IconButton size="sm" onClick={startRecording} title="语音速记 (Voice Memo)">
      <Icon.Mic className="w-5 h-5 mx-auto text-zinc-600 dark:text-zinc-300 hover:text-blue-600 transition-colors" />
    </IconButton>
  );
};

export default VoiceRecorder;
