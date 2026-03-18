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
import VizPage from './pages/VizPage';
import ToolsPage from './pages/ToolsPage';
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
            <Route path="/blast" element={<BlastPage />} />
            <Route path="/viz" element={<VizPage />} />
            <Route path="/data" element={<DataPage />} />
            <Route path="/gene/:geneId" element={<GenePage />} />
            <Route path="/chromosome/:seqid" element={<ChromosomePage />} />
            <Route path="/tools" element={<ToolsPage />} />
          </Routes>

          <Divider my="xl" />
          <AppFooter />
        </Container>
      </AppShell.Main>

      <ChatWidget />
    </AppShell>
  );
}