export const jbrowseConfig = {
  assembly: {
    name: 'GRCg6a',
    aliases: ['galGal6'],
    sequence: {
      type: 'ReferenceSequenceTrack',
      trackId: 'GRCg6a-ReferenceSequenceTrack',
      adapter: {
        type: 'IndexedFastaAdapter',
        fastaLocation: {
          uri: '/genome/GCF_000002315.6_GRCg6a_genomic.chr.fna',
        },
        faiLocation: {
          uri: '/genome/GCF_000002315.6_GRCg6a_genomic.chr.fna.fai',
        },
      },
    },
    refNameAliases: {
      adapter: {
        type: 'RefNameAliasAdapter',
        uri: '/genome/aliases.txt',
      },
    },
  },
  tracks: [
    {
      type: 'FeatureTrack',
      trackId: 'genes',
      name: 'NCBI RefSeq Genes',
      assemblyNames: ['GRCg6a'],
      adapter: {
        type: 'Gff3Adapter',
        gffLocation: {
          uri: '/genome/GCF_000002315.6_GRCg6a_genomic.gff',
        },
      },
    },
  ],
  defaultSession: {
    name: 'this session',
    view: {
      id: 'linearGenomeView',
      type: 'LinearGenomeView',
      init: {
        assembly: 'GRCg6a',
        loc: 'chr1:1..5000000',
        tracks: ['genes'],
      },
    },
  },
}