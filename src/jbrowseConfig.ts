import LinearComparativeViewPlugin from "@jbrowse/plugin-linear-comparative-view";

const BWDATA_FILES = [
  "E0_Female1.bw", "E0_Female2.bw", "E0_Female3.bw",
  "E0_Male1.bw", "E0_Male3.bw",
  "E3_5_Female1.bw", "E3_5_Female2.bw", "E3_5_Female3.bw",
  "E3_5_Male1.bw", "E3_5_Male2.bw", "E3_5_Male3.bw",
  "E4_5_Female2.bw", "E4_5_Female3.bw",
  "E4_5_Male1.bw", "E4_5_Male2.bw", "E4_5_Male3.bw",
  "E5_5_Female1.bw", "E5_5_Female2.bw", "E5_5_Male1.bw", "E5_5_Male2.bw", "E5_5_Male3.bw",
  "E6_5_Female1.bw", "E6_5_Female2.bw",
  "E6_5_Male1.bw", "E6_5_Male3.bw",
  "E18_5_Female2.bw", "E18_5_Female3.bw",
  "E18_5_Male1.bw", "E18_5_Male2.bw",
];

function parseBwName(filename: string) {
  const base = filename.replace(/\.bw$/, "");
  const m = base.match(/^(E[\d_]+)_(Female|Male)(\d+)$/);
  if (!m) return { stage: base, sex: "", rep: "", label: base };
  const [, stage, sex, rep] = m;
  const stageLabel = stage.replace(/_/, ".").replace("E", "E ");
  return {
    stage,
    stageLabel,
    sex,
    rep,
    label: `${stageLabel} ${sex} ${rep}`,
    trackId: base,
  };
}

export function buildBwTracks() {
  return BWDATA_FILES.map((file) => {
    const { trackId, label } = parseBwName(file);
    return {
      type: "QuantitativeTrack",
      trackId,
      name: label,
      assemblyNames: ["GRCg6a"],
      adapter: {
        type: "BigWigAdapter",
        bigWigLocation: { uri: `/bwdata/${file}` },
      },
    };
  });
}

// GRCg6a assembly definition
export const grcg6aAssembly = {
  name: "GRCg6a",
  aliases: ["galGal6"],
  sequence: {
    type: "ReferenceSequenceTrack",
    trackId: "GRCg6a-ReferenceSequenceTrack",
    adapter: {
      type: "IndexedFastaAdapter",
      fastaLocation: { uri: "/genome/GCF_000002315.6_GRCg6a_genomic.chr.fna" },
      faiLocation: { uri: "/genome/GCF_000002315.6_GRCg6a_genomic.chr.fna.fai" },
    },
  },
  refNameAliases: {
    adapter: {
      type: "RefNameAliasAdapter",
      uri: "/genome/aliases.txt",
    },
  },
};

// GRCg7b assembly definition
export const grcg7bAssembly = {
  name: "GRCg7b",
  aliases: ["galGal7"],
  sequence: {
    type: "ReferenceSequenceTrack",
    trackId: "GRCg7b-ReferenceSequenceTrack",
    adapter: {
      type: "IndexedFastaAdapter",
      fastaLocation: { uri: "/genome/GCF_016699485.2_GRCg7b_main_chr.fna" },
      faiLocation: { uri: "/genome/GCF_016699485.2_GRCg7b_main_chr.fna.fai" },
    },
  },
  refNameAliases: {
    adapter: {
      type: "RefNameAliasAdapter",
      uri: "/genome/grcg7b_main_aliases.txt",
    },
  },
};

// Gene tracks for both assemblies
export const geneTrackGRCg6a = {
  type: "FeatureTrack",
  trackId: "genes-grcg6a",
  name: "GRCg6a Genes",
  assemblyNames: ["GRCg6a"],
  adapter: {
    type: "Gff3Adapter",
    gffLocation: { uri: "/genome/GCF_000002315.6_GRCg6a_genomic.gff" },
  },
};

export const geneTrackGRCg7b = {
  type: "FeatureTrack",
  trackId: "genes-grcg7b",
  name: "GRCg7b Genes",
  assemblyNames: ["GRCg7b"],
  adapter: {
    type: "Gff3Adapter",
    gffLocation: { uri: "/genome/GCF_016699485.2_GRCg7b_main_chr.gff.gz" },
  },
};

// Synteny track connecting both assemblies (can be added manually via UI)
export const syntenyTrackConfig = {
  type: "SyntenyTrack",
  trackId: "synteny-grcg6a-grcg7b",
  name: "GRCg6a -> GRCg7b Natural Synteny",
  assemblyNames: ["GRCg6a", "GRCg7b"],
  adapter: {
    type: "PAFAdapter",
    pafLocation: { uri: "/comparative/paf/file?assembly_1=GRCg6a&assembly_2=GRCg7b&mode=natural&min_quality=30&min_identity=85&min_alignment_length=50000" },
    queryAssembly: "GRCg6a",
    targetAssembly: "GRCg7b",
  },
};

export const jbrowseModes = {
  single: {
    label: "GRCg6a",
    config: "Single assembly",
    tracks: ["GRCg6a Genes", "BigWig"],
  },
  comparative: {
    label: "GRCg6a vs GRCg7b",
    config: "Dual assembly",
    tracks: [
      "GRCg6a Genes",
      "GRCg7b Genes",
      "GRCg6a -> GRCg7b Natural Synteny",
    ],
  },
} as const;

export const comparativeTrackIds = {
  grcg6aGenes: "genes-grcg6a",
  grcg7bGenes: "genes-grcg7b",
  synteny: "synteny-grcg6a-grcg7b",
} as const;

// ============================================
// Config 1: Single assembly (GRCg6a only)
// ============================================
export const jbrowseConfig = {
  plugins: [LinearComparativeViewPlugin],
  assembly: grcg6aAssembly,
  tracks: [
    geneTrackGRCg6a,
    ...buildBwTracks(),
  ],
  defaultSession: {
    name: "GRCg6a Browser",
    view: {
      id: "linearGenomeView",
      type: "LinearGenomeView",
      init: {
        assembly: "GRCg6a",
        loc: "chr1:1..5000000",
        tracks: ["genes-grcg6a"],
      },
    },
  },
};

// ============================================
// Config 2: Comparative view (GRCg6a + GRCg7b)
// ============================================
export const comparativeConfig = {
  plugins: [LinearComparativeViewPlugin],
  assembly: grcg6aAssembly,  // Primary assembly
  assemblies: [grcg6aAssembly, grcg7bAssembly],  // All assemblies
  tracks: [
    geneTrackGRCg6a,
    geneTrackGRCg7b,
    ...buildBwTracks(),
  ],
  defaultSession: {
    name: "GRCg6a vs GRCg7b",
    view: {
      id: "lgv",
      type: "LinearGenomeView",
      init: {
        assembly: "GRCg6a",
        loc: "chr1:1..5000000",
        tracks: ["genes-grcg6a"],
      },
    },
  },
};
