const API_BASE = 'http://localhost:8000';

// ========== Types ==========

export interface GenomeHealthResponse {
  status: string;
  module: string;
  version: string;
}

export interface GenomeFileItem {
  file_type: string;
  filename: string;
  path: string;
  size_bytes: number;
  is_compressed: boolean;
  exists: boolean;
}

export interface GenomeFilesResponse {
  success: boolean;
  scan_dir: string;
  files: Record<string, GenomeFileItem>;
  missing_types: string[];
  total_size: number;
}

export interface GenomeRunResponse {
  success: boolean;
  job_id: string;
  message: string;
  status_url: string;
}

export interface GenomeJobItem {
  job_id: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  created_at: string;
  started_at?: string;
  finished_at?: string;
  message?: string;
  output_dir?: string;
}

export interface GenomeJobsResponse {
  success: boolean;
  jobs: GenomeJobItem[];
}

export type GenomeJobResponse = GenomeJobItem;

export interface GenomeModuleResults {
  [key: string]: unknown;
}

export interface GenomeResultResponse {
  success: boolean;
  job_id: string;
  results: GenomeModuleResults;
}

export interface GenomeModuleResultResponse {
  success: boolean;
  job_id: string;
  module: string;
  results: unknown;
}

export interface ChartFile {
  png?: string;
  svg?: string;
  html?: string;
  json?: string;
}

export interface ChartItem {
  chart_key: string;
  title: string;
  files: ChartFile;
}

export interface TableFile {
  csv?: string;
  xlsx?: string;
}

export interface TableItem {
  name: string;
  title: string;
  files: TableFile;
}

export interface ResultItem {
  name: string;
  files: { json: string };
}

export interface MetadataItem {
  name: string;
  files: { json: string };
}

export interface GenomeDownloadsResponse {
  success: boolean;
  job_id: string;
  downloads: {
    charts: ChartItem[];
    tables: TableItem[];
    result: ResultItem[];
    metadata: MetadataItem[];
  };
}

export interface CarouselImage {
  filename: string;
  title: string;
  description: string;
  target_url?: string;
}

export interface CarouselManifest {
  images: CarouselImage[];
}

export interface GenomeCarouselResponse {
  success: boolean;
  manifest: CarouselManifest;
  files: string[];
}

export interface GenomeCarouselImagesResponse {
  success: boolean;
  count: number;
  images: string[];
}

// ========== API Functions ==========

export async function getGenomeHealth(): Promise<GenomeHealthResponse> {
  const response = await fetch(`${API_BASE}/genome/health`);
  if (!response.ok) {
    throw new Error(`Genome health check failed: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenomeFiles(): Promise<GenomeFilesResponse> {
  const response = await fetch(`${API_BASE}/genome/files`);
  if (!response.ok) {
    throw new Error(`Failed to get genome files: ${response.statusText}`);
  }
  return response.json();
}

export async function scanGenomeFiles(): Promise<GenomeFilesResponse> {
  const response = await fetch(`${API_BASE}/genome/files/scan`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to scan genome files: ${response.statusText}`);
  }
  return response.json();
}

export async function runGenomeAnalysis(): Promise<GenomeRunResponse> {
  const response = await fetch(`${API_BASE}/genome/analysis/run`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to run analysis: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenomeJobs(): Promise<GenomeJobsResponse> {
  const response = await fetch(`${API_BASE}/genome/jobs`);
  if (!response.ok) {
    throw new Error(`Failed to get jobs: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenomeJob(jobId: string): Promise<GenomeJobResponse> {
  const response = await fetch(`${API_BASE}/genome/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to get job: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenomeResult(jobId: string): Promise<GenomeResultResponse> {
  const response = await fetch(`${API_BASE}/genome/jobs/${encodeURIComponent(jobId)}/result`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to get result: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenomeModuleResult(
  jobId: string,
  moduleName: string
): Promise<GenomeModuleResultResponse> {
  const response = await fetch(
    `${API_BASE}/genome/jobs/${encodeURIComponent(jobId)}/result/${encodeURIComponent(moduleName)}`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to get module result: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenomeDownloads(jobId: string): Promise<GenomeDownloadsResponse> {
  const response = await fetch(`${API_BASE}/genome/jobs/${encodeURIComponent(jobId)}/downloads`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to get downloads: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenomeCarousel(): Promise<GenomeCarouselResponse> {
  const response = await fetch(`${API_BASE}/genome/carousel`);
  if (!response.ok) {
    throw new Error(`Failed to get carousel: ${response.statusText}`);
  }
  return response.json();
}

export async function getGenomeCarouselImages(): Promise<GenomeCarouselImagesResponse> {
  const response = await fetch(`${API_BASE}/genome/carousel/images`);
  if (!response.ok) {
    throw new Error(`Failed to get carousel images: ${response.statusText}`);
  }
  return response.json();
}

// ========== URL Builders ==========

export function buildGenomeDownloadUrl(
  jobId: string,
  category: string,
  filename: string
): string {
  return `${API_BASE}/genome/download/${encodeURIComponent(jobId)}/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`;
}

export function buildPublicCarouselImageUrl(filename: string): string {
  return `${API_BASE}/genome/download/public/carousel/${encodeURIComponent(filename)}`;
}

export function buildChartUrl(jobId: string, chartKey: string, format: string): string {
  return `${API_BASE}/genome/charts/${encodeURIComponent(jobId)}/${encodeURIComponent(chartKey)}/${format}`;
}

// ========== Sample Results API (Pre-generated) ==========

export async function getSampleResult(): Promise<GenomeResultResponse> {
  const response = await fetch(`${API_BASE}/genome/sample/result`);
  if (!response.ok) {
    throw new Error(`Failed to get sample result: ${response.statusText}`);
  }
  return response.json();
}

export async function getSampleDownloads(): Promise<GenomeDownloadsResponse> {
  const response = await fetch(`${API_BASE}/genome/sample/downloads`);
  if (!response.ok) {
    throw new Error(`Failed to get sample downloads: ${response.statusText}`);
  }
  return response.json();
}

export function buildSampleChartUrl(chartKey: string, format: string): string {
  return `${API_BASE}/genome/sample/charts/${encodeURIComponent(chartKey)}/${format}`;
}

export function buildSampleTableUrl(tableName: string, format: string): string {
  return `${API_BASE}/genome/sample/tables/${encodeURIComponent(tableName)}/${format}`;
}

export interface SampleStatusResponse {
  available: boolean;
  has_charts: boolean;
  chart_count: number;
  results_dir: string;
}

export async function getSampleStatus(): Promise<SampleStatusResponse> {
  const response = await fetch(`${API_BASE}/genome/sample/status`);
  if (!response.ok) {
    throw new Error(`Failed to get sample status: ${response.statusText}`);
  }
  return response.json();
}

// ========== Job Chart Endpoints (direct) ==========

// Get chart JSON for a job
export async function getJobChartJson(jobId: string, chartKey: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/genome/charts/${encodeURIComponent(jobId)}/${encodeURIComponent(chartKey)}/json`);
  if (!response.ok) {
    throw new Error(`Chart JSON not found: ${chartKey}`);
  }
  return response.json();
}

// Get chart HTML for a job
export function buildJobChartHtmlUrl(jobId: string, chartKey: string): string {
  return `${API_BASE}/genome/charts/${encodeURIComponent(jobId)}/${encodeURIComponent(chartKey)}/html`;
}

// ========== Sample Chart Endpoints (direct) ==========

// Get sample chart JSON
export async function getSampleChartJson(chartKey: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/genome/sample/charts/${encodeURIComponent(chartKey)}/json`);
  if (!response.ok) {
    throw new Error(`Sample chart JSON not found: ${chartKey}`);
  }
  return response.json();
}

// ========== Sample File Endpoints ==========

export function buildSampleFileUrl(category: string, filename: string): string {
  return `${API_BASE}/genome/sample/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`;
}

// ========== Sample Downloads Response (enhanced) ==========

export interface SampleDownloadsResponse {
  success: boolean;
  job_id: string;
  is_sample: boolean;
  downloads: {
    charts: ChartItem[];
    tables: TableItem[];
    result: ResultItem[];
    metadata: MetadataItem[];
  };
}

// ========== Carousel Image List ==========

export interface CarouselImageItem {
  filename: string;
  size_bytes: number;
  url: string;
}

export interface GenomeCarouselImagesListResponse {
  success: boolean;
  count: number;
  images: CarouselImageItem[];
}

// ========== KGML Cache Endpoints (proxy via genome API or direct) ==========

// Note: KGML cache endpoints are at /annotations/kegg/kgml-cache/*
// These are imported from geneApi.ts

// ========== KEGG Pathway Image URL Builders ==========

// Pathway image via annotations router
export function buildKEGGPathwayImageUrl(pathwayId: string): string {
  return `${API_BASE}/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/image`;
}

// Pathway image via kegg-images router
export function buildKEGGImageUrl(pathwayId: string): string {
  return `${API_BASE}/kegg-images/${encodeURIComponent(pathwayId)}.png`;
}

// Public carousel image download
export function buildPublicCarouselUrl(filename: string): string {
  return `${API_BASE}/genome/download/public/carousel/${encodeURIComponent(filename)}`;
}
