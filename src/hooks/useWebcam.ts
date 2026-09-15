"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WebcamStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "denied"
  | "unsupported"
  | "error";

export type WebcamErrorKind =
  | "NotAllowedError"
  | "NotFoundError"
  | "NotReadableError"
  | "OverconstrainedError"
  | "SecurityError"
  | "UnknownError";

export interface UseWebcamResult {
  status: WebcamStatus;
  errorKind: WebcamErrorKind | null;
  errorMessage: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  start: () => Promise<void>;
  stop: () => void;
}

function classifyError(err: unknown): {
  kind: WebcamErrorKind;
  message: string;
  status: WebcamStatus;
} {
  if (!err || typeof err !== "object") {
    return {
      kind: "UnknownError",
      message: "Something went wrong accessing the camera.",
      status: "error",
    };
  }

  const name = "name" in err && typeof err.name === "string" ? err.name : "";
  const message =
    "message" in err && typeof err.message === "string"
      ? err.message
      : "Camera access failed.";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      kind: "NotAllowedError",
      message: "Camera permission was denied. Enable it in browser settings to try on frames.",
      status: "denied",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      kind: "NotFoundError",
      message: "No camera was found on this device.",
      status: "error",
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      kind: "NotReadableError",
      message: "The camera is already in use by another application.",
      status: "error",
    };
  }
  if (name === "OverconstrainedError") {
    return {
      kind: "OverconstrainedError",
      message: "No camera matched the requested constraints.",
      status: "error",
    };
  }
  if (name === "SecurityError") {
    return {
      kind: "SecurityError",
      message: "Camera access is blocked on this origin (HTTPS or localhost required).",
      status: "error",
    };
  }

  return { kind: "UnknownError", message, status: "error" };
}

export function useWebcam(): UseWebcamResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<WebcamStatus>("idle");
  const [errorKind, setErrorKind] = useState<WebcamErrorKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus((prev) => (prev === "ready" ? "idle" : prev));
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrorKind("UnknownError");
      setErrorMessage("This browser does not support camera access (getUserMedia).");
      return;
    }

    setStatus("requesting");
    setErrorKind(null);
    setErrorMessage(null);

    // Stop any previous stream before requesting a new one.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    try {
      // PERF: lower ideal resolution on narrow viewports (mobile floor ~30fps).
      const mobile =
        typeof window !== "undefined" &&
        (window.innerWidth < 768 ||
          /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: mobile ? 640 : 1280 },
          height: { ideal: mobile ? 480 : 720 },
        },
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);

      const video = videoRef.current;
      if (video) {
        video.srcObject = mediaStream;
        await video.play();
      }

      setStatus("ready");
    } catch (err) {
      const classified = classifyError(err);
      setErrorKind(classified.kind);
      setErrorMessage(classified.message);
      setStatus(classified.status);
      setStream(null);
    }
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // Attach stream if the video element mounts after permission is granted.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {
        /* autoplay may fail briefly; user gesture already occurred via start() */
      });
    }
  }, [stream]);

  return {
    status,
    errorKind,
    errorMessage,
    videoRef,
    stream,
    start,
    stop,
  };
}
