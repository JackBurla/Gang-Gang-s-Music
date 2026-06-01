import type {
  AggregateResponse,
  Submission,
  SubmissionSummary,
} from "./types";

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const API_BASE = RAW_BASE.replace(/\/$/, "");

if (!API_BASE) {
  console.warn(
    "[gang-gangs-music] VITE_API_BASE_URL is not set. API requests will fail until the Railway URL is configured."
  );
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function fetchAggregate(): Promise<AggregateResponse> {
  return request<AggregateResponse>("/api/aggregate");
}

export function fetchSubmissions(): Promise<SubmissionSummary[]> {
  return request<SubmissionSummary[]>("/api/submissions");
}

export function fetchSubmission(name: string): Promise<Submission> {
  return request<Submission>(`/api/submissions/${encodeURIComponent(name)}`);
}

export type SubmitInput = {
  name: string;
  editToken?: string;
  artists: string[];
  albums: { album: string; artist: string }[];
};

export function postSubmission(input: SubmitInput): Promise<{
  submission: Submission;
  editToken: string;
}> {
  return request("/api/submissions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function refreshArtwork(
  name: string,
  editToken: string
): Promise<{ submission: Submission }> {
  return request(
    `/api/submissions/${encodeURIComponent(name)}/refresh-artwork`,
    {
      method: "POST",
      body: JSON.stringify({ editToken }),
    }
  );
}

export type PreviewResponse = {
  imageUrl: string | null;
  matchedName: string | null;
};

export function fetchPreview(
  type: "artist" | "album",
  q: string,
  artist?: string
): Promise<PreviewResponse> {
  const params = new URLSearchParams({ type, q });
  if (artist) params.set("artist", artist);
  return request(`/api/preview?${params.toString()}`);
}
