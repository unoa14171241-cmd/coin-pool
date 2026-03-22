export type DataQuality = "exact" | "estimated" | "heuristic" | "placeholder";

export interface ResponseMetadata {
  source: string;
  generatedAt: string;
  stale: boolean;
  quality: DataQuality;
}
