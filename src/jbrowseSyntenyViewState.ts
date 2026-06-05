import PluginManager from "@jbrowse/core/PluginManager";
import RpcManager from "@jbrowse/core/rpc/RpcManager";
import TextSearchManager from "@jbrowse/core/TextSearch/TextSearchManager";
import { ConfigurationSchema, getConf, readConfObject } from "@jbrowse/core/configuration";
import assemblyManagerFactory, { assemblyConfigSchemaFactory } from "@jbrowse/core/assemblyManager";
import { onPatch, types, cast, getParent, getSnapshot } from "@jbrowse/mobx-state-tree";
import Alignments from "@jbrowse/plugin-alignments";
import Arc from "@jbrowse/plugin-arc";
import Authentication from "@jbrowse/plugin-authentication";
import BED from "@jbrowse/plugin-bed";
import Canvas from "@jbrowse/plugin-canvas";
import Config from "@jbrowse/plugin-config";
import DataManagement from "@jbrowse/plugin-data-management";
import GCContent from "@jbrowse/plugin-gccontent";
import GFF3 from "@jbrowse/plugin-gff3";
import LegacyJBrowse from "@jbrowse/plugin-legacy-jbrowse";
import LinearGenomeView from "@jbrowse/plugin-linear-genome-view";
import Sequence from "@jbrowse/plugin-sequence";
import Trix from "@jbrowse/plugin-trix";
import Variants from "@jbrowse/plugin-variants";
import Wiggle from "@jbrowse/plugin-wiggle";
import {
  BaseSessionModel,
  ConnectionManagementSessionMixin,
  DialogQueueSessionMixin,
  DrawerWidgetSessionMixin,
  FormatAboutConfigSchemaFactory,
  FormatDetailsConfigSchemaFactory,
  HierarchicalConfigSchemaFactory,
  ReferenceManagementSessionMixin,
  SessionTracksManagerSessionMixin,
  TracksManagerSessionMixin,
} from "@jbrowse/product-core";
import LinearComparativeViewPlugin from "@jbrowse/plugin-linear-comparative-view";
import { assembleLocString } from "@jbrowse/core/util";
import SnackbarModel from "@jbrowse/core/ui/SnackbarModel";
import type { IJsonPatch } from "@jbrowse/mobx-state-tree";
import {
  comparativeTrackIds,
  geneTrackGRCg6a,
  geneTrackGRCg7b,
  grcg6aAssembly,
  grcg7bAssembly,
} from "./jbrowseConfig";

const corePlugins = [
  Canvas,
  Alignments,
  Authentication,
  BED,
  Config,
  DataManagement,
  GFF3,
  LegacyJBrowse,
  LinearGenomeView,
  Sequence,
  Variants,
  Wiggle,
  GCContent,
  Trix,
  Arc,
  LinearComparativeViewPlugin,
];

export interface SyntenyFeature {
  uniqueId: string;
  refName: string;
  start: number;
  end: number;
  type: string;
  name: string;
  strand: 1 | -1;
  assemblyName: "GRCg6a";
  CIGAR: string;
  score: number;
  mate: {
    uniqueId: string;
    refName: string;
    start: number;
    end: number;
    type: string;
    strand: 1 | -1;
    assemblyName: "GRCg7b";
  };
}

interface CreateSyntenyViewStateOptions {
  features: SyntenyFeature[];
  location?: string | { refName: string; start?: number; end?: number };
  mateLocation?: string;
  onChange?: (patch: IJsonPatch, reversePatch: IJsonPatch) => void;
}

function createConfigModel(pluginManager: PluginManager, assemblyConfigSchemasType: ReturnType<typeof assemblyConfigSchemaFactory>) {
  return types
    .model("ComparativeConfiguration", {
      configuration: ConfigurationSchema("Root", {
        rpc: RpcManager.configSchema,
        highResolutionScaling: {
          type: "number",
          defaultValue: 2,
        },
        hierarchical: HierarchicalConfigSchemaFactory(),
        formatDetails: FormatDetailsConfigSchemaFactory(),
        formatAbout: FormatAboutConfigSchemaFactory(),
        theme: { type: "frozen", defaultValue: {} },
      }),
      assemblies: types.array(assemblyConfigSchemasType),
      tracks: types.array(pluginManager.pluggableConfigSchemaType("track")),
      internetAccounts: types.array(pluginManager.pluggableConfigSchemaType("internet account")),
      connections: types.array(pluginManager.pluggableConfigSchemaType("connection")),
      aggregateTextSearchAdapters: types.array(pluginManager.pluggableConfigSchemaType("text search adapter")),
      plugins: types.frozen(),
    })
    .views((self) => ({
      get assembly() {
        return self.assemblies[0];
      },
      get assemblyName() {
        return readConfObject(self.assemblies[0], "name");
      },
      get rpcManager() {
        return getParent<{ rpcManager: RpcManager }>(self).rpcManager;
      },
    }));
}

function createComparativeSessionModel(pluginManager: PluginManager) {
  const linearGenomeView = pluginManager.getViewType("LinearGenomeView")?.stateModel;
  const linearSyntenyView = pluginManager.getViewType("LinearSyntenyView")?.stateModel;
  if (!linearGenomeView || !linearSyntenyView) {
    throw new Error("JBrowse LinearGenomeView or LinearSyntenyView plugin is not registered");
  }
  const viewModel = types.union(
    { dispatcher: (snapshot: { type?: string }) => (snapshot.type === "LinearSyntenyView" ? linearSyntenyView : linearGenomeView) },
    linearGenomeView,
    linearSyntenyView,
  );

  return types
    .compose(
      "ComparativeSession",
      BaseSessionModel(pluginManager),
      DrawerWidgetSessionMixin(pluginManager),
      ConnectionManagementSessionMixin(pluginManager),
      DialogQueueSessionMixin(pluginManager),
      ReferenceManagementSessionMixin(pluginManager),
      SessionTracksManagerSessionMixin(pluginManager),
      TracksManagerSessionMixin(pluginManager),
      SnackbarModel(),
    )
    .props({
      view: viewModel,
      sessionTracks: types.array(pluginManager.pluggableConfigSchemaType("track")),
    })
    .views((self) => ({
      get version() {
        return getParent<{ version: string }>(self).version;
      },
      get disableAddTracks() {
        return false;
      },
      get assemblies() {
        return getParent<{ config: { assemblies: unknown[] } }>(self).config.assemblies;
      },
      get assemblyNames() {
        return this.assemblies.map((assembly) => readConfObject(assembly as Parameters<typeof readConfObject>[0], "name"));
      },
      get connections() {
        return getParent<{ config: { connections: unknown[] } }>(self).config.connections;
      },
      get assemblyManager() {
        return getParent<{ assemblyManager: unknown }>(self).assemblyManager;
      },
      get views() {
        return [self.view];
      },
      renderProps() {
        return {
          theme: getConf(self, "theme"),
          highResolutionScaling: getConf(self, "highResolutionScaling"),
        };
      },
    }))
    .actions((self) => ({
      addView(typeName: string, initialState = {}) {
        self.view = cast({
          ...initialState,
          type: typeName,
        });
        return self.view;
      },
      removeView() {},
      getTrackActionMenuItems() {
        return [];
      },
    }));
}

function createComparativeModel() {
  const pluginManager = new PluginManager(corePlugins.map((Plugin) => new Plugin())).createPluggableElements();
  const Session = createComparativeSessionModel(pluginManager);
  const assemblyConfig = assemblyConfigSchemaFactory(pluginManager);
  const AssemblyManager = assemblyManagerFactory(assemblyConfig, pluginManager);
  const ConfigModel = createConfigModel(pluginManager, assemblyConfig);
  const rootModel = types
    .model("ReactLinearSyntenyView", {
      config: ConfigModel,
      session: Session,
      assemblyManager: types.optional(AssemblyManager, {}),
      internetAccounts: types.array(pluginManager.pluggableMstType("internet account", "stateModel")),
    })
    .volatile((self) => ({
      error: undefined as unknown,
      rpcManager: new RpcManager(pluginManager, self.config.configuration.rpc, {
        MainThreadRpcDriver: {},
      }),
      textSearchManager: new TextSearchManager(pluginManager),
      adminMode: false,
      version: "embedded",
    }))
    .actions((self) => ({
      setError(error: unknown) {
        self.error = error;
      },
      addInternetAccount(acct: unknown) {
        self.internetAccounts.push(cast(acct));
      },
      findAppropriateInternetAccount() {
        return null;
      },
    }))
    .views((self) => ({
      get jbrowse() {
        return self.config;
      },
    }));

  return { model: rootModel, pluginManager };
}

function buildSyntenyTrack(features: SyntenyFeature[]) {
  return {
    type: "SyntenyTrack",
    trackId: comparativeTrackIds.synteny,
    name: "GRCg6a -> GRCg7b Synteny",
    assemblyNames: ["GRCg6a", "GRCg7b"],
    adapter: {
      type: "FromConfigAdapter",
      features,
    },
  };
}

export function createLinearSyntenyViewState({
  features,
  location = "chr1:1..5000000",
  mateLocation,
  onChange,
}: CreateSyntenyViewStateOptions) {
  const { model, pluginManager } = createComparativeModel();
  const loc = typeof location === "string" ? location : assembleLocString(location);
  const stateTree = model.create(
    {
      config: {
        configuration: {},
        assemblies: [grcg6aAssembly, grcg7bAssembly],
        tracks: [
          geneTrackGRCg6a,
          geneTrackGRCg7b,
          buildSyntenyTrack(features),
        ],
        internetAccounts: [],
        connections: [],
        aggregateTextSearchAdapters: [],
      },
      session: {
        name: "GRCg6a vs GRCg7b Linear Synteny",
        view: {
          id: "linearSyntenyView",
          type: "LinearSyntenyView",
          drawCurves: true,
          init: {
            views: [
              {
                assembly: "GRCg6a",
                loc,
                tracks: [comparativeTrackIds.grcg6aGenes],
              },
              {
                assembly: "GRCg7b",
                ...(mateLocation ? { loc: mateLocation } : {}),
                tracks: [comparativeTrackIds.grcg7bGenes],
              },
            ],
            tracks: [[comparativeTrackIds.synteny]],
          },
        },
      },
    },
    { pluginManager },
  );

  pluginManager.setRootModel(stateTree as Parameters<typeof pluginManager.setRootModel>[0]);
  pluginManager.configure();
  if (onChange) {
    onPatch(stateTree, onChange);
  }
  getSnapshot(stateTree);
  return stateTree;
}
