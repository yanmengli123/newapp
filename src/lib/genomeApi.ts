import { API_BASE, apiFetch } from './apiClient';

// Re-export for convenience
export { API_BASE };

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
  return apiFetch<GenomeHealthResponse>('/genome/health');
}

export async function getGenomeFiles(): Promise<GenomeFilesResponse> {
  return apiFetch<GenomeFilesResponse>('/genome/files');
}

export async function scanGenomeFiles(): Promise<GenomeFilesResponse> {
  return apiFetch<GenomeFilesResponse>('/genome/files/scan', { method: 'POST' });
}

export async function runGenomeAnalysis(): Promise<GenomeRunResponse> {
  return apiFetch<GenomeRunResponse>('/genome/analysis/run', { method: 'POST' });
}

export async function getGenomeJobs(): Promise<GenomeJobsResponse> {
  return apiFetch<GenomeJobsResponse>('/genome/jobs');
}

export async function getGenomeJob(jobId: string): Promise<GenomeJobResponse> {
  return apiFetch<GenomeJobResponse>(`/genome/jobs/${encodeURIComponent(jobId)}`);
}

export async function getGenomeResult(jobId: string): Promise<GenomeResultResponse> {
  return apiFetch<GenomeResultResponse>(`/genome/jobs/${encodeURIComponent(jobId)}/result`);
}

export async function getGenomeModuleResult(
  jobId: string,
  moduleName: string
): Promise<GenomeModuleResultResponse> {
  return apiFetch<GenomeModuleResultResponse>(
    `/genome/jobs/${encodeURIComponent(jobId)}/result/${encodeURIComponent(moduleName)}`
  );
}

export async function getGenomeDownloads(jobId: string): Promise<GenomeDownloadsResponse> {
  return apiFetch<GenomeDownloadsResponse>(`/genome/jobs/${encodeURIComponent(jobId)}/downloads`);
}

export async function getGenomeCarousel(): Promise<GenomeCarouselResponse> {
  return apiFetch<GenomeCarouselResponse>('/genome/carousel');
}

export async function getGenomeCarouselImages(): Promise<GenomeCarouselImagesResponse> {
  return apiFetch<GenomeCarouselImagesResponse>('/genome/carousel/images');
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
  return apiFetch<GenomeResultResponse>('/genome/sample/result');
}

export async function getSampleDownloads(): Promise<GenomeDownloadsResponse> {
  return apiFetch<GenomeDownloadsResponse>('/genome/sample/downloads');
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
  return apiFetch<SampleStatusResponse>('/genome/sample/status');
}

// ========== Job Chart Endpoints (direct) ==========

export async function getJobChartJson(jobId: string, chartKey: string): Promise<unknown> {
  return apiFetch<unknown>(`/genome/charts/${encodeURIComponent(jobId)}/${encodeURIComponent(chartKey)}/json`);
}

export function buildJobChartHtmlUrl(jobId: string, chartKey: string): string {
  return `${API_BASE}/genome/charts/${encodeURIComponent(jobId)}/${encodeURIComponent(chartKey)}/html`;
}

// ========== Sample Chart Endpoints (direct) ==========

export async function getSampleChartJson(chartKey: string): Promise<unknown> {
  return apiFetch<unknown>(`/genome/sample/charts/${encodeURIComponent(chartKey)}/json`);
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

// ========== KEGG Pathway Image URL Builders ==========

export function buildKEGGPathwayImageUrl(pathwayId: string): string {
  return `${API_BASE}/annotations/kegg/pathway/${encodeURIComponent(pathwayId)}/image`;
}

export function buildKEGGImageUrl(pathwayId: string): string {
  return `${API_BASE}/kegg-images/${encodeURIComponent(pathwayId)}.png`;
}

export function buildPublicCarouselUrl(filename: string): string {
  return `${API_BASE}/genome/download/public/carousel/${encodeURIComponent(filename)}`;
}
