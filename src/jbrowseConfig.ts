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
  // e.g. "E0_Female1.bw" → "E0 Female 1"
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

function buildBwTracks() {
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

export const jbrowseConfig = {
  assembly: {
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
  },
  tracks: [
    {
      type: "FeatureTrack",
      trackId: "genes",
      name: "NCBI RefSeq Genes",
      assemblyNames: ["GRCg6a"],
      adapter: {
        type: "Gff3Adapter",
        gffLocation: { uri: "/genome/GCF_000002315.6_GRCg6a_genomic.gff" },
      },
    },
    ...buildBwTracks(),
  ],
  defaultSession: {
    name: "this session",
    view: {
      id: "linearGenomeView",
      type: "LinearGenomeView",
      init: {
        assembly: "GRCg6a",
        loc: "chr1:1..5000000",
        tracks: ["genes"],
      },
    },
  },
};