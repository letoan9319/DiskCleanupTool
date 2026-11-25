import React, { createContext, useContext, useEffect, useState } from "react";
import { LangCode, TRANSLATIONS, TranslationDict } from "./translations";

interface I18nContextValue {
  lang: LangCode;
  setLang: (lang: LangCode) => void;
  t: TranslationDict;
}

const STORAGE_KEY = "diskcleanup.lang";

const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  setLang: () => {},
  t: TRANSLATIONS.en,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as LangCode | null;
      if (saved && saved in TRANSLATIONS) return saved;
    } catch {
      // ignore storage errors
    }
    return "en";
  });

  const setLang = (next: LangCode) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: TRANSLATIONS[lang] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
