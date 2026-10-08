import axios from "axios";

export type STTModel = "nova-3" | "nova-2";
export type STTLanguage = "zh" | "en" | "auto";

export interface STTOptions {
  apiKey: string;
  model?: STTModel | string;
  language?: STTLanguage | string;
}

export interface VoiceMemoSetting {
  deepgramApiKey: string;
  sttModel: STTModel;
  sttLanguage: STTLanguage;
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

const createSilentWavBlob = (): Blob => {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, 16000, true); // 16kHz
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, 0, true);
  return new Blob([buffer], { type: "audio/wav" });
};

export const verifyDeepgramApiKey = async (apiKey: string, model: STTModel = "nova-3"): Promise<{ success: boolean; message: string }> => {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { success: false, message: "请输入 API Key" };
  }
  try {
    // 使用支持浏览器 CORS 的 /v1/listen 端点发送静音探针以验证密钥及模型连通性
    const probeBlob = createSilentWavBlob();
    const res = await axios.post(`https://api.deepgram.com/v1/listen?model=${model}`, probeBlob, {
      headers: {
        Authorization: `Token ${trimmed}`,
        "Content-Type": "audio/wav",
      },
      timeout: 10000,
    });
    if (res.status === 200) {
      return { success: true, message: `Deepgram API Key 验证通过！(${model} 模型可用)` };
    }
    return { success: false, message: `验证未通过 (状态码 ${res.status})` };
  } catch (error: any) {
    if (error.response) {
      if (error.response.status === 401 || error.response.status === 403) {
        return { success: false, message: "API Key 无效或未授权，请检查后重试" };
      }
      const errMsg = error.response.data?.err_msg || error.response.data?.message;
      return { success: false, message: errMsg || `请求失败 (${error.response.status})` };
    }
    return { success: false, message: error.message || "网络请求失败，请检查网络连接" };
  }
};

export const transcribeAudioWithDeepgram = async (audioBlob: Blob, options: STTOptions): Promise<string> => {
  const { apiKey, model = "nova-3", language = "zh" } = options;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("未配置 Deepgram API Key");
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

  const contentType = audioBlob.type && audioBlob.type !== "" ? audioBlob.type : "audio/*";

  try {
    const response = await axios.post(`https://api.deepgram.com/v1/listen?${queryParams.toString()}`, audioBlob, {
      headers: {
        Authorization: `Token ${apiKey.trim()}`,
        "Content-Type": contentType,
      },
      timeout: 45000,
    });

    const transcript = response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    return transcript.trim();
  } catch (error: any) {
    if (error.response) {
      if (error.response.status === 401 || error.response.status === 403) {
        throw new Error("Deepgram API Key 无效或未授权 (401/403)");
      }
      const errMsg = error.response.data?.err_msg || error.response.data?.message;
      throw new Error(errMsg || `Deepgram 转写请求失败 (${error.response.status})`);
    }
    if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
      throw new Error("转写请求超时 (45s)，请检查网络连接");
    }
    throw new Error(error.message || "转写网络请求失败，请检查网络连接");
  }
};

export const transcribeResourceWithDeepgram = async (resourceUrl: string, options?: Partial<STTOptions>): Promise<string> => {
  const setting = getVoiceMemoSetting();
  const apiKey = options?.apiKey || setting.deepgramApiKey;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("未配置 Deepgram API Key，请先配置");
  }

  const response = await fetch(resourceUrl);
  if (!response.ok) {
    throw new Error(`获取音频失败 (HTTP ${response.status})`);
  }
  const audioBlob = await response.blob();
  return transcribeAudioWithDeepgram(audioBlob, {
    apiKey,
    model: options?.model || setting.sttModel,
    language: options?.language || setting.sttLanguage,
  });
};
