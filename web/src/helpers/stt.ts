import axios from "axios";

export interface STTOptions {
  apiKey: string;
  language?: string;
}

export interface VoiceMemoSetting {
  deepgramApiKey: string;
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
        sttLanguage: parsed.sttLanguage || "zh",
        autoAppendToEditor: parsed.autoAppendToEditor !== false,
      };
    }
  } catch {
    // fallback
  }
  return {
    deepgramApiKey: "",
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

export const transcribeAudioWithDeepgram = async (audioBlob: Blob, options: STTOptions): Promise<string> => {
  const { apiKey, language = "zh" } = options;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Missing Deepgram API Key");
  }

  const queryParams = new URLSearchParams({
    model: "nova-2",
    language: language === "auto" ? "zh" : language,
    smart_format: "true",
    punctuate: "true",
  });

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
