import { Box, Stack, rem } from "@mantine/core";
import EscOverviewSection from "../components/expression/EscOverviewSection";
import GeneSearch from "../components/home/GeneSearch";
import HeroSection from "../components/home/HeroSection";

export default function HomePage() {
  return (
    <Stack gap={rem(40)}>
      <HeroSection />
      <Box id="search">
        <GeneSearch />
      </Box>
      <EscOverviewSection />
    </Stack>
  );
}
