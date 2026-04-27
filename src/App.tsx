import { AppShell, Container, Divider } from '@mantine/core';
import { Route, Routes } from 'react-router-dom';
import AppFooter from './components/layout/AppFooter';
import AppHeader from './components/layout/AppHeader';
import BlastPage from './pages/BlastPage';
import BrowserPage from './pages/BrowserPage';
import ChromosomePage from './pages/ChromosomePage';
import DataPage from './pages/DataPage';
import GenePage from './pages/GenePage';
import GeneQueryPage from './pages/GeneQueryPage';
import HomePage from './pages/HomePage';
import JBrowsePage from './pages/JBrowsePage';
import JBrowseGenePage from './pages/JBrowseGenePage';
import VizPage from './pages/VizPage';
import ToolsPage from './pages/ToolsPage';
import GenomeHomePage from './pages/GenomeHomePage';
import GenomeFilesPage from './pages/GenomeFilesPage';
import GenomeRunPage from './pages/GenomeRunPage';
import GenomeJobsPage from './pages/GenomeJobsPage';
import GenomeJobPage from './pages/GenomeJobPage';
import GenomeResultPage from './pages/GenomeResultPage';
import GenomeDownloadsPage from './pages/GenomeDownloadsPage';
import DownloadsPage from './pages/DownloadsPage';
import PictureMakerPage from './pages/PictureMakerPage';
import GOEnrichmentPage from './pages/GOEnrichmentPage';
import ChatWidget from './components/chat/ChatWidget';

export default function App() {
  return (
    <AppShell header={{ height: 72 }} padding="md">
      <AppShell.Header>
        <AppHeader />
      </AppShell.Header>

      <AppShell.Main>
        <Container size="xl" py="xl">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/query" element={<GeneQueryPage />} />
            <Route path="/browser" element={<BrowserPage />} />
            <Route path="/jbrowse" element={<JBrowsePage />} />
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
          </Routes>

          <Divider my="xl" />
          <AppFooter />
        </Container>
      </AppShell.Main>

      <ChatWidget />
    </AppShell>
  );
}