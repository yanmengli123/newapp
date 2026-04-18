import { useCallback, useEffect, useState } from "react";
import type {
  ChartCustomizerConfig,
  ChartPreset,
  ChartType,
  ScopeLevel,
  SharedChartTheme,
  PerChartConfig,
} from "./chartCustomizer.types";
import { DEFAULT_CHART_CUSTOMIZER_CONFIG, PRESET_COLORS } from "./chartCustomizer.defaults";

const STORAGE_KEY = "expression_chart_customizer_v1";

function loadFromStorage(): ChartCustomizerConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ChartCustomizerConfig;
  } catch {
    return null;
  }
}

function saveToStorage(config: ChartCustomizerConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage write failure — ignore silently
  }
}

export interface UseChartCustomizerReturn {
  config: ChartCustomizerConfig;
  scope: ScopeLevel;
  selectedChartType: ChartType;
  setScope: (s: ScopeLevel) => void;
  setSelectedChartType: (t: ChartType) => void;
  updateTheme: (partial: Partial<SharedChartTheme>) => void;
  updateChartStyle: (chartType: ChartType, partial: Partial<unknown>) => void;
  updatePreset: (preset: ChartPreset) => void;
  resetCurrent: () => void;
  resetAll: () => void;
  isLoaded: boolean;
}

export function useChartCustomizer(): UseChartCustomizerReturn {
  const [config, setConfig] = useState<ChartCustomizerConfig>(() => {
    return loadFromStorage() ?? DEFAULT_CHART_CUSTOMIZER_CONFIG;
  });
  const [scope, setScope] = useState<ScopeLevel>("theme");
  const [selectedChartType, setSelectedChartType] = useState<ChartType>("stage");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      saveToStorage(config);
    }
  }, [config, isLoaded]);

  const updateTheme = useCallback((partial: Partial<SharedChartTheme>) => {
    setConfig((prev) => ({
      ...prev,
      theme: { ...prev.theme, ...partial },
    }));
  }, []);

  const updatePreset = useCallback((preset: ChartPreset) => {
    const colors = PRESET_COLORS[preset] ?? PRESET_COLORS.default;
    setConfig((prev) => ({
      ...prev,
      theme: { ...prev.theme, preset, colors: { ...colors } },
    }));
  }, []);

  const updateChartStyle = useCallback((chartType: ChartType, partial: Partial<unknown>) => {
    setConfig((prev) => ({
      ...prev,
      charts: {
        ...prev.charts,
        [chartType]: {
          ...(prev.charts[chartType] ?? {}),
          ...partial,
        },
      } as PerChartConfig,
    }));
  }, []);

  const resetCurrent = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      charts: {
        ...prev.charts,
        [selectedChartType]: {},
      },
    }));
  }, [selectedChartType]);

  const resetAll = useCallback(() => {
    setConfig(DEFAULT_CHART_CUSTOMIZER_CONFIG);
  }, []);

  return {
    config,
    scope,
    selectedChartType,
    setScope,
    setSelectedChartType,
    updateTheme,
    updateChartStyle,
    updatePreset,
    resetCurrent,
    resetAll,
    isLoaded,
  };
}
