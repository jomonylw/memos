import axios from "axios";

export interface STTOptions {
  apiKey: string;
  model?: "nova-3" | "nova-2" | string;
  language?: string;
}

export interface VoiceMemoSetting {
  deepgramApiKey: string;
  sttModel: "nova-3" | "nova-2";
  sttLanguage: "zh" | "en" | "auto";
  autoAppendToEditor: boolean;
}

const VOICE_MEMO_SETTING_KEY = "memos_voice_setting";

export const getVoiceMemoSetting = (): VoiceMemoSetting => {
  try {
    const raw = localStorage.getItem(VOICE_MEMO_SETTING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        deepgramApiKey: parsed.deepgramApiKey || "",
        sttModel: parsed.sttModel === "nova-2" ? "nova-2" : "nova-3",
        sttLanguage: parsed.sttLanguage || "zh",
        autoAppendToEditor: parsed.autoAppendToEditor !== false,
      };
    }
  } catch {
    // fallback
  }
  return {
    deepgramApiKey: "",
    sttModel: "nova-3",
    sttLanguage: "zh",
    autoAppendToEditor: true,
  };
};

export const setVoiceMemoSetting = (setting: Partial<VoiceMemoSetting>) => {
  const current = getVoiceMemoSetting();
  const updated = { ...current, ...setting };
  try {
    localStorage.setItem(VOICE_MEMO_SETTING_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to save voice memo setting", error);
  }
  return updated;
};

export const checkMicrophoneSupport = (): {
  supported: boolean;
  isSecure: boolean;
  reason?: "insecure-context" | "unsupported-browser";
} => {
  if (typeof window === "undefined") {
    return { supported: false, isSecure: false, reason: "unsupported-browser" };
  }
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const isSecure = Boolean(window.isSecureContext || isLocal || window.location.protocol === "https:");

  if (!isSecure) {
    return { supported: false, isSecure: false, reason: "insecure-context" };
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { supported: false, isSecure: true, reason: "unsupported-browser" };
  }

  return { supported: true, isSecure: true };
};

export const verifyDeepgramApiKey = async (apiKey: string): Promise<{ success: boolean; message: string }> => {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { success: false, message: "请输入 API Key" };
  }
  try {
    const res = await axios.get("https://api.deepgram.com/v1/projects", {
      headers: {
        Authorization: `Token ${trimmed}`,
      },
      timeout: 10000,
    });
    if (res.status === 200) {
      return { success: true, message: "Deepgram API Key 验证通过！" };
    }
    return { success: false, message: `验证未通过 (状态码 ${res.status})` };
  } catch (error: any) {
    if (error.response) {
      if (error.response.status === 401 || error.response.status === 403) {
        return { success: false, message: "API Key 无效或未授权，请检查后重试" };
      }
      return { success: false, message: error.response.data?.message || `请求失败 (${error.response.status})` };
    }
    return { success: false, message: error.message || "网络请求失败，请检查网络连接" };
  }
};

export const transcribeAudioWithDeepgram = async (audioBlob: Blob, options: STTOptions): Promise<string> => {
  const { apiKey, model = "nova-3", language = "zh" } = options;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Missing Deepgram API Key");
  }

  const queryParams = new URLSearchParams({
    model: model || "nova-3",
    smart_format: "true",
    punctuate: "true",
  });

  if (language === "auto") {
    queryParams.set("detect_language", "true");
  } else {
    queryParams.set("language", language);
  }

  const response = await axios.post(`https://api.deepgram.com/v1/listen?${queryParams.toString()}`, audioBlob, {
    headers: {
      Authorization: `Token ${apiKey.trim()}`,
      "Content-Type": audioBlob.type || "audio/webm",
    },
    timeout: 30000,
  });

  const transcript = response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return transcript.trim();
};
