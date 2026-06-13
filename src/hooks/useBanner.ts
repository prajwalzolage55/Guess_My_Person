import { useState, useRef, useEffect, useCallback } from "react";

export interface BannerState {
  message: string;
  type: "error" | "warning" | "success" | null;
}

export function useBanner() {
  const [banner, setBanner] = useState<BannerState>({ message: "", type: null });
  const bannerTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showBanner = useCallback((msg: string, type: "error" | "warning" | "success" | null = null) => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
    }
    setBanner({ message: msg, type });
    bannerTimerRef.current = setTimeout(() => {
      setBanner({ message: "", type: null });
    }, 3000);
  }, []);

  const hideBanner = useCallback(() => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
    }
    setBanner({ message: "", type: null });
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }
    };
  }, []);

  return { banner, showBanner, hideBanner };
}
