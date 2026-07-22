import { Box, Button, Container, Group, Text, ThemeIcon, Menu } from "@mantine/core";
import { IconDna, IconTool, IconBox, IconChartBar, IconDownload, IconPhoto } from "@tabler/icons-react";
import { Link } from "react-router-dom";

function HeaderNav() {
  return (
    <Group gap="xs" visibleFrom="sm">
      <Button variant="subtle" component={Link} to="/">
        Home
      </Button>
      <Button variant="subtle" component={Link} to="/query">
        Query
      </Button>
      <Button variant="subtle" component={Link} to="/jbrowse">
        JBrowse
      </Button>
      <Menu shadow="md" width={235}>
        <Menu.Target>
          <Button variant="subtle" leftSection={<IconDna size={16} />}>
            Annotations
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Annotation Catalogs</Menu.Label>
          <Menu.Item component={Link} to="/gene-families" leftSection={<IconDna size={14} />}>
            Gene Families & Domains
          </Menu.Item>
          <Menu.Item component={Link} to="/go-enrichment" leftSection={<IconChartBar size={14} />}>
            GO Enrichment
          </Menu.Item>
          <Menu.Item component={Link} to="/tools" leftSection={<IconBox size={14} />}>
            Domain Search
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Menu shadow="md" width={220}>
        <Menu.Target>
          <Button variant="subtle" leftSection={<IconChartBar size={16} />}>
            Genome Analysis
          </Button>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>Genome Analysis</Menu.Label>
          <Menu.Item component={Link} to="/genome" leftSection={<IconChartBar size={14} />}>
            Overview
          </Menu.Item>
          <Menu.Item component={Link} to="/genome/files" leftSection={<IconBox size={14} />}>
            Files
          </Menu.Item>
          <Menu.Item component={Link} to="/genome/jobs" leftSection={<IconBox size={14} />}>
            Jobs
          </Menu.Item>
          <Menu.Item component={Link} to="/genome/run" leftSection={<IconBox size={14} />}>
            Run Analysis
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item component={Link} to="/genome/jobs/sample/result" leftSection={<IconChartBar size={14} />}>
            Sample Results
          </Menu.Item>
          <Menu.Item component={Link} to="/genome/jobs/sample/downloads" leftSection={<IconBox size={14} />}>
            Sample Downloads
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item component={Link} to="/downloads" leftSection={<IconDownload size={14} />}>
            ESC Atlas Downloads
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Menu shadow="md" width={200}>
        <Menu.Target>
          <Button variant="subtle" leftSection={<IconTool size={16} />}>
            Tools
          </Button>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>Bioinformatics Tools</Menu.Label>
          <Menu.Item
            component={Link}
            to="/tools"
            leftSection={<IconDna size={14} />}
          >
            Primer3 Design
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Button variant="subtle" component={Link} to="/viz">
        Visualizations
      </Button>
      <Button variant="subtle" component={Link} to="/picture-maker" leftSection={<IconPhoto size={16} />}>
        Picture Maker
      </Button>
      <Button variant="subtle" component={Link} to="/comparative" leftSection={<IconDna size={16} />}>
        Comparative
      </Button>
      <Button variant="subtle" component={Link} to="/data">
        Datasets
      </Button>
      <Button variant="subtle" component={Link} to="/blast">
        BLAST
      </Button>
    </Group>
  );
}

export default function AppHeader() {
  return (
    <Container size="xl" h="100%">
      <Group h="100%" justify="space-between">
        <Group gap="sm">
          <ThemeIcon radius="xl" size={40} variant="light" color="cyan">
            <IconDna size={22} />
          </ThemeIcon>

          <Box
            component={Link}
            to="/"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <Text fw={800} size="lg">
              GRCg6a Gene Browser
            </Text>
            <Text size="xs" c="dimmed">
              Chicken Genome Database
            </Text>
          </Box>
        </Group>

        <HeaderNav />
      </Group>
    </Container>
  );
}
