import { Box, Button, Container, Group, Text, ThemeIcon } from "@mantine/core";
import { IconDna } from "@tabler/icons-react";
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
      <Button variant="subtle" component={Link} to="/viz">
        Visualizations
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
