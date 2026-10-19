import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelConfigValue } from '@/features/canvas/ui/ModelConfigPicker';
import type { VideoModelConfigValue } from '@/features/canvas/application/videoModelCatalog';

export interface CanvasGenerationDefaults {
  image?: ModelConfigValue;
  video?: VideoModelConfigValue;
}

export const useCanvasDefaultsStore = create<CanvasGenerationDefaults & {
  setDefaults: (defaults: CanvasGenerationDefaults) => void;
}>()(persist((set) => ({
  setDefaults: (defaults) => set(defaults),
}), {
  name: 'mvaigc-canvas-generation-defaults',
  partialize: ({ image, video }) => ({ image, video }),
}));
