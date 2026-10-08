import { IconButton } from "@mui/joy";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
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
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const filename = `voice-memo-${Date.now()}.${extension}`;
      const audioFile = new File([audioBlob], filename, { type: mimeType });

      try {
        const uploadPromise = onAudioRecorded(audioFile);
        const setting = getVoiceMemoSetting();
        let transcribePromise: Promise<string> = Promise.resolve("");
        if (setting.deepgramApiKey) {
          transcribePromise = transcribeAudioWithDeepgram(audioBlob, {
            apiKey: setting.deepgramApiKey,
            model: setting.sttModel,
            language: setting.sttLanguage,
          }).catch(() => {
            toast.error("Deepgram 语音转文字失败，请检查 API Key");
            return "";
          });
        }

        const [, transcript] = await Promise.all([uploadPromise, transcribePromise]);
        if (transcript && onTranscribeText && setting.autoAppendToEditor) {
          onTranscribeText(transcript);
          toast.success("录音已保存并转写完成");
        } else {
          toast.success("录音已保存至附件");
        }
      } catch {
        toast.error("录音保存失败");
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
      <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono select-none">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        <span>{formatSeconds(recordingSeconds)}</span>
        <button
          type="button"
          onClick={stopRecording}
          className="ml-1 p-0.5 rounded hover:bg-red-500/20 text-red-600 dark:text-red-300 font-semibold"
          title="完成录音并转写"
        >
          <Icon.Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={cancelRecording}
          className="p-0.5 rounded hover:bg-red-500/20 text-red-600 dark:text-red-300"
          title="取消录音"
        >
          <Icon.X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs select-none">
        <Icon.Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>转写中...</span>
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
