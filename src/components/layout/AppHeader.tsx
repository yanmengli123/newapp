import { Box, Button, Container, Group, Text, ThemeIcon, Menu } from "@mantine/core";
import {
  IconBox,
  IconChartBar,
  IconDna,
  IconDownload,
  IconMenu2,
  IconPhoto,
  IconTool,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";

function HeaderNav() {
  return (
    <Group gap={0} visibleFrom="xl" wrap="nowrap">
      <Button size="compact-sm" variant="subtle" component={Link} to="/">
        Home
      </Button>
      <Button size="compact-sm" variant="subtle" component={Link} to="/query">
        Query
      </Button>
      <Button size="compact-sm" variant="subtle" component={Link} to="/jbrowse">
        JBrowse
      </Button>
      <Button size="compact-sm" variant="subtle" component={Link} to="/gene-families" leftSection={<IconDna size={16} />}>
        Gene Families
      </Button>
      <Menu shadow="md" width={235}>
        <Menu.Target>
          <Button size="compact-sm" variant="subtle" leftSection={<IconDna size={16} />}>
            Annotations
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Annotation Catalogs</Menu.Label>
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
          <Button size="compact-sm" variant="subtle" leftSection={<IconChartBar size={16} />}>
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
          <Button size="compact-sm" variant="subtle" leftSection={<IconTool size={16} />}>
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
      <Button size="compact-sm" variant="subtle" component={Link} to="/viz">
        Visualizations
      </Button>
      <Menu shadow="md" width={210}>
        <Menu.Target>
          <Button size="compact-sm" variant="subtle" leftSection={<IconMenu2 size={16} />}>
            More
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item component={Link} to="/picture-maker" leftSection={<IconPhoto size={14} />}>
            Picture Maker
          </Menu.Item>
          <Menu.Item component={Link} to="/comparative" leftSection={<IconDna size={14} />}>
            Comparative
          </Menu.Item>
          <Menu.Item component={Link} to="/data" leftSection={<IconBox size={14} />}>
            Datasets
          </Menu.Item>
          <Menu.Item component={Link} to="/blast" leftSection={<IconTool size={14} />}>
            BLAST
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

function CompactHeaderNav() {
  return (
    <Menu shadow="md" width={235}>
      <Menu.Target>
        <Button hiddenFrom="xl" variant="light" leftSection={<IconMenu2 size={16} />}>
          Navigation
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component={Link} to="/">Home</Menu.Item>
        <Menu.Item component={Link} to="/query">Query</Menu.Item>
        <Menu.Item component={Link} to="/jbrowse">JBrowse</Menu.Item>
        <Menu.Item component={Link} to="/gene-families" leftSection={<IconDna size={14} />}>
          Gene Families
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item component={Link} to="/go-enrichment" leftSection={<IconChartBar size={14} />}>
          GO Enrichment
        </Menu.Item>
        <Menu.Item component={Link} to="/genome" leftSection={<IconChartBar size={14} />}>
          Genome Analysis
        </Menu.Item>
        <Menu.Item component={Link} to="/tools" leftSection={<IconTool size={14} />}>
          Tools
        </Menu.Item>
        <Menu.Item component={Link} to="/viz">Visualizations</Menu.Item>
        <Menu.Item component={Link} to="/picture-maker" leftSection={<IconPhoto size={14} />}>
          Picture Maker
        </Menu.Item>
        <Menu.Item component={Link} to="/comparative" leftSection={<IconDna size={14} />}>
          Comparative
        </Menu.Item>
        <Menu.Item component={Link} to="/data" leftSection={<IconBox size={14} />}>
          Datasets
        </Menu.Item>
        <Menu.Item component={Link} to="/blast">BLAST</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export default function AppHeader() {
  return (
    <Container size="xl" h="100%">
      <Group h="100%" justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
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

        <Group wrap="nowrap">
          <HeaderNav />
          <CompactHeaderNav />
        </Group>
      </Group>
    </Container>
  );
}
