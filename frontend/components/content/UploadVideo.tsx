"use client";

/**
 * UploadVideo — direct browser-to-Cloudinary upload.
 *
 * The video binary never passes through the application backend. The browser
 * asks the backend to sign the Cloudinary parameters, uploads the file straight
 * to Cloudinary, then sends only the resulting asset metadata back to be
 * registered. The API secret stays on the server; the browser only ever sees the
 * signature.
 *
 * XMLHttpRequest is used rather than fetch because fetch cannot report upload
 * progress, and a large video gives the creator no feedback otherwise.
 */
import { useRef, useState } from "react";
import { CheckCircle2, UploadCloud, XCircle } from "lucide-react";
import { authorizeUpload, getMyVideo, registerVideo } from "@/lib/api";
import { CloudinaryUploadResult, isResumableUpload, ResumableUploadAuthorization, VideoRecord, VideoStatus } from "@/lib/types";
import { Button } from "@/components/ui/Button";

type Phase = "idle" | "authorizing" | "uploading" | "registering" | "processing" | "done" | "error";

function uploadToCloudinary(
  params: {
    cloud_name: string;
    api_key: string;
    folder: string;
    context: string;
    timestamp: number;
    signature: string;
    resource_type: string;
  },
  file: File,
  onProgress: (percent: number) => void
): Promise<CloudinaryUploadResult> {
  // Phone videos are often larger than the 100 MB Cloudinary accepts in a single
  // request, and mobile connections drop. Larger files are sent in chunks
  // (Cloudinary's chunked upload: same signed parameters, X-Unique-Upload-Id and
  // Content-Range headers), and each chunk is retried on a network error.
  const total = file.size;
  if (total <= CHUNK_SIZE) {
    return sendPart(params, file, null, (loaded) => onProgress(Math.round((loaded / Math.max(total, 1)) * 100)));
  }
  return (async () => {
    const uploadId = crypto.randomUUID().replaceAll("-", "");
    let result: CloudinaryUploadResult | null = null;
    for (let start = 0; start < total; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE, total);
      const range = { uploadId, header: `bytes ${start}-${end - 1}/${total}` };
      for (let attempt = 1; ; attempt += 1) {
        try {
          result = await sendPart(params, file.slice(start, end), range, (loaded) =>
            onProgress(Math.min(99, Math.round(((start + loaded) / total) * 100))),
          );
          break;
        } catch (error) {
          if (!(error instanceof NetworkError) || attempt >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        }
      }
    }
    onProgress(100);
    return result!;
  })();
}

const CHUNK_SIZE = 20 * 1024 * 1024;

class NetworkError extends Error {}

function sendPart(
  params: { cloud_name: string; api_key: string; folder: string; context: string; timestamp: number; signature: string; resource_type: string },
  blob: Blob,
  range: { uploadId: string; header: string } | null,
  onLoaded: (bytes: number) => void,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", blob, blob instanceof File ? blob.name : "video");
    form.append("api_key", params.api_key);
    form.append("timestamp", String(params.timestamp));
    form.append("signature", params.signature);
    form.append("folder", params.folder);
    form.append("context", params.context);
    form.append("type", "authenticated");
    // resource_type is deliberately not a form field. It travels in the URL path
    // and Cloudinary excludes it from the signed parameter string, so sending it
    // here would be redundant at best.

    const request = new XMLHttpRequest();
    request.open("POST", `https://api.cloudinary.com/v1_1/${params.cloud_name}/${params.resource_type}/upload`);
    if (range) {
      request.setRequestHeader("X-Unique-Upload-Id", range.uploadId);
      request.setRequestHeader("Content-Range", range.header);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onLoaded(Math.round((event.loaded / event.total) * blob.size));
    };
    request.onerror = () => reject(new NetworkError("The upload to Cloudinary was interrupted. Check your connection and try again."));
    request.onload = () => {
      let payload: CloudinaryUploadResult & { error?: { message?: string } };
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error(`Cloudinary returned an unreadable response (HTTP ${request.status}).`));
        return;
      }
      if (request.status < 200 || request.status >= 300 || payload.error) {
        reject(new Error(friendlyCloudinaryError(payload.error?.message, request.status)));
        return;
      }
      resolve(payload);
    };
    request.send(form);
  });
}

function friendlyCloudinaryError(message: string | undefined, status: number): string {
  const tooLarge = message ? /file size too large\.\s*got (\d+)\.\s*maximum is (\d+)/i.exec(message) : null;
  if (tooLarge) {
    const mb = (bytes: string) => `${Math.round(Number(bytes) / (1024 * 1024))} MB`;
    return `This video is ${mb(tooLarge[1])}, but uploads are currently limited to ${mb(tooLarge[2])}. Try a shorter clip or a lower-resolution export.`;
  }
  if (message && /file size too large/i.test(message)) return "This video is larger than uploads currently allow. Try a shorter clip or a lower-resolution export.";
  if (message && /unsupported video format/i.test(message)) {
    return "Cloudinary couldn't read this video. Use an MP4, MOV or WebM file.";
  }
  return message ? `Cloudinary rejected the upload: ${message}` : `Cloudinary rejected the upload (HTTP ${status}).`;
}

// --- Resumable uploads (content service) -------------------------------------

const TYPES_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", "3gp": "video/3gpp",
};

/** Some browsers report no type for videos (for example .mov on Android); fall back to the extension. */
function videoType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPES_BY_EXTENSION[ext] ?? "video/mp4";
}

/** One PUT to a resumable session. `blob` null asks how much the storage already has. */
function putChunk(url: string, blob: Blob | null, contentRange: string, onLoaded: (bytes: number) => void): Promise<{ status: number; next: number | null }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Range", contentRange);
    request.upload.onprogress = (event) => { if (event.lengthComputable) onLoaded(event.loaded); };
    request.onerror = () => reject(new NetworkError("The upload was interrupted. Check your connection and try again."));
    request.onload = () => {
      // 308 + "Range: bytes=0-N" means the storage holds bytes 0..N; continue at N+1.
      const range = /bytes=0-(\d+)/.exec(request.getResponseHeader("Range") ?? "");
      resolve({ status: request.status, next: range ? Number(range[1]) + 1 : null });
    };
    request.send(blob);
  });
}

async function uploadResumable(auth: ResumableUploadAuthorization, file: File, onProgress: (percent: number) => void): Promise<void> {
  const { url, chunk_bytes: chunk } = auth.upload;
  const total = file.size;
  let offset = 0;
  let failures = 0;
  while (offset < total) {
    const end = Math.min(offset + chunk, total);
    const start = offset;
    try {
      const result = await putChunk(url, file.slice(start, end), `bytes ${start}-${end - 1}/${total}`,
        (loaded) => onProgress(Math.min(99, Math.round(((start + loaded) / total) * 100))));
      if (result.status === 200 || result.status === 201) break;
      if (result.status === 308) { offset = result.next ?? end; failures = 0; continue; }
      if (result.status === 404 || result.status === 410) throw new Error("The upload session expired. Please choose the file again.");
      throw new Error(`The upload was rejected (HTTP ${result.status}).`);
    } catch (error) {
      if (!(error instanceof NetworkError) || ++failures > 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * failures));
      // Resume from what the storage already has instead of starting over.
      const status = await putChunk(url, null, `bytes */${total}`, () => {}).catch(() => null);
      if (status && (status.status === 200 || status.status === 201)) break;
      if (status && status.status === 308) offset = status.next ?? 0;
    }
  }
  onProgress(100);
}

/** Waits while the watermarked preview is prepared (usually seconds). */
async function waitUntilProcessed(videoId: string, timeoutMs = 5 * 60 * 1000): Promise<VideoRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { video } = await getMyVideo(videoId);
    if (video.status !== "processing" || Date.now() > deadline) return video;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

export function UploadVideo({ onUploaded }: { onUploaded: (video: VideoRecord) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "authorizing" || phase === "uploading" || phase === "registering" || phase === "processing";

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    setFileName(file.name);
    try {
      setPhase("authorizing");
      const auth = await authorizeUpload({ name: file.name, type: videoType(file), size: file.size });

      if (isResumableUpload(auth)) {
        if (file.size > auth.upload.max_bytes) {
          throw new Error(`This video is ${Math.round(file.size / 1048576)} MB; the limit is ${Math.round(auth.upload.max_bytes / 1048576)} MB.`);
        }
        setPhase("uploading");
        await uploadResumable(auth, file, setProgress);
        setPhase("registering");
        let video = (await registerVideo({
          title: file.name.trim().slice(0, 200) || "Untitled video",
          upload_session_id: auth.upload_session_id,
          asset_id: auth.asset_id,
        })).video;
        if (video.status === "processing") {
          setPhase("processing");
          video = await waitUntilProcessed(video.id);
        }
        if (video.status === "failed") throw new Error("This video could not be processed. Upload an MP4, MOV or WebM file under 10 minutes.");
        setPhase("done");
        onUploaded(video);
        return;
      }

      setPhase("uploading");
      const result = await uploadToCloudinary(auth, file, setProgress);

      setPhase("registering");
      // Cloudinary reports duration as a float and may still be transcoding, so
      // round to the integer the backend stores and report the real state
      // instead of assuming the asset is immediately offerable.
      const mediaState: VideoStatus =
        result.resource_status === "failed" ? "failed"
        : result.resource_status === "pending" ? "processing"
        : "ready";
      // The context is echoed from the signed authorisation rather than read back
      // from Cloudinary, so registration always carries the session the backend
      // issued. The backend consumes it once.
      const registered = await registerVideo({
        title: file.name.trim().slice(0, 200) || "Untitled video",
        upload_session_id: auth.upload_session_id,
        public_id: result.public_id,
        asset_version: result.version,
        resource_type: "video",
        format: result.format,
        context: auth.context,
        status: mediaState,
        // The browser has the bytes and could hash them, but the server never
        // sees the file, so it records this as an unverified claim or nothing.
        original_sha256: null,
        bytes: result.bytes ?? null,
        duration_seconds: result.duration ? Math.round(result.duration) : null,
        width: result.width ?? null,
        height: result.height ?? null,
      });

      setPhase("done");
      onUploaded(registered.video);
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "The upload could not be completed.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (phase === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <CheckCircle2 size={16} /> Uploaded and registered
        </p>
        <p className="mt-1 break-all text-xs text-emerald-700">{fileName}</p>
        <Button variant="secondary" className="mt-3" onClick={() => { setPhase("idle"); setFileName(null); }}>
          Upload another video
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm font-semibold text-blue-900">Upload a new video</p>
      <p className="mt-1 text-xs text-blue-800">
        The file goes straight from your browser to secure media storage. It is never uploaded through the
        application server.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="mt-3 block w-full text-sm text-blue-900 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {busy && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs font-medium text-blue-800">
            <span>
              {phase === "authorizing" && "Authorising upload…"}
              {phase === "uploading" && `Uploading${progress ? ` ${progress}%` : ""}…`}
              {phase === "registering" && "Registering your video…"}
              {phase === "processing" && "Preparing your watermarked preview…"}
            </span>
            {phase === "uploading" && <span>{progress}%</span>}
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-blue-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-200"
              style={{ width: phase === "uploading" ? `${progress}%` : phase === "registering" || phase === "processing" ? "100%" : "5%" }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 text-sm text-red-700">
          <XCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {!busy && !error && (
        <p className="mt-3 flex items-center gap-2 text-xs text-blue-700">
          <UploadCloud size={14} /> MP4, WebM or MOV.
        </p>
      )}
    </div>
  );
}
