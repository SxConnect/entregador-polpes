import { useEffect, useRef, useState } from "react";
import { sendLocation } from "../services/api.ts";

export function useGeolocation(active: boolean) {
  const [error, setError] = useState<string | null>(null);
  const [lastPosition, setLastPosition] = useState<{ lat: number; lng: number } | null>(null);
  const lastSentRef = useRef<number>(0);

  useEffect(() => {
    if (!active || !("geolocation" in navigator)) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setLastPosition({ lat: latitude, lng: longitude });

        const now = Date.now();
        // Limita o envio de telemetria a cada 8 segundos
        if (now - lastSentRef.current > 8000) {
          lastSentRef.current = now;
          sendLocation(latitude, longitude, accuracy).catch((err) => {
            console.warn("[GPS] Falha ao enviar telemetria:", err);
          });
        }
      },
      (err) => {
        console.warn("[GPS] Erro de geolocalização:", err);
        setError(err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [active]);

  return { lastPosition, error };
}
