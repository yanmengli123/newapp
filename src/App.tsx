import { lazy, Suspense } from 'react';
import { AppShell, Container, Divider, Loader, Stack } from '@mantine/core';
import { Route, Routes } from 'react-router-dom';
import AppFooter from './components/layout/AppFooter';
import AppHeader from './components/layout/AppHeader';
import ChatWidget from './components/chat/ChatWidget';

const BlastPage = lazy(() => import('./pages/BlastPage'));
const BrowserPage = lazy(() => import('./pages/BrowserPage'));
const ChromosomePage = lazy(() => import('./pages/ChromosomePage'));
const ComparativeGenomicsPage = lazy(() => import('./pages/ComparativeGenomicsPage'));
const DataPage = lazy(() => import('./pages/DataPage'));
const DownloadsPage = lazy(() => import('./pages/DownloadsPage'));
const GenePage = lazy(() => import('./pages/GenePage'));
const GeneQueryPage = lazy(() => import('./pages/GeneQueryPage'));
const GenomeDownloadsPage = lazy(() => import('./pages/GenomeDownloadsPage'));
const GenomeFilesPage = lazy(() => import('./pages/GenomeFilesPage'));
const GenomeHomePage = lazy(() => import('./pages/GenomeHomePage'));
const GenomeJobPage = lazy(() => import('./pages/GenomeJobPage'));
const GenomeJobsPage = lazy(() => import('./pages/GenomeJobsPage'));
const GenomeResultPage = lazy(() => import('./pages/GenomeResultPage'));
const GenomeRunPage = lazy(() => import('./pages/GenomeRunPage'));
const GOEnrichmentPage = lazy(() => import('./pages/GOEnrichmentPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const JBrowseGenePage = lazy(() => import('./pages/JBrowseGenePage'));
const JBrowsePage = lazy(() => import('./pages/JBrowsePage'));
const PictureMakerPage = lazy(() => import('./pages/PictureMakerPage'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const VizPage = lazy(() => import('./pages/VizPage'));

function RouteFallback() {
  return (
    <Stack align="center" py="xl">
      <Loader size="sm" />
    </Stack>
  );
}

export default function App() {
  return (
    <AppShell header={{ height: 72 }} padding="md">
      <AppShell.Header>
        <AppHeader />
      </AppShell.Header>

      <AppShell.Main>
        <Container size="xl" py="xl">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/query" element={<GeneQueryPage />} />
              <Route path="/browser" element={<BrowserPage />} />
              <Route path="/jbrowse" element={<JBrowsePage />} />
              <Route path="/jbrowseh" element={<JBrowsePage />} />
              <Route path="/jbrowse/gene" element={<JBrowseGenePage />} />
              <Route path="/blast" element={<BlastPage />} />
              <Route path="/viz" element={<VizPage />} />
              <Route path="/data" element={<DataPage />} />
              <Route path="/gene/:geneId" element={<GenePage />} />
              <Route path="/chromosome/:seqid" element={<ChromosomePage />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/genome" element={<GenomeHomePage />} />
              <Route path="/genome/files" element={<GenomeFilesPage />} />
              <Route path="/genome/run" element={<GenomeRunPage />} />
              <Route path="/genome/jobs" element={<GenomeJobsPage />} />
              <Route path="/genome/jobs/:jobId" element={<GenomeJobPage />} />
              <Route path="/genome/jobs/:jobId/result" element={<GenomeResultPage />} />
              <Route path="/genome/jobs/:jobId/downloads" element={<GenomeDownloadsPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/picture-maker" element={<PictureMakerPage />} />
              <Route path="/go-enrichment" element={<GOEnrichmentPage />} />
              <Route path="/comparative" element={<ComparativeGenomicsPage />} />
            </Routes>
          </Suspense>

          <Divider my="xl" />
          <AppFooter />
        </Container>
      </AppShell.Main>

      <ChatWidget />
    </AppShell>
  );
}
