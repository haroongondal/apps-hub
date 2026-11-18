import DesignMedia from 'design-media';
import { realSearchToolDeps } from './search-tool-deps.ts';
import type { SearchToolDeps } from './search-tool.ts';
import { visionToolDeps, type VisionTool } from './vision-tool.ts';

export function realVisionToolDeps(tool: VisionTool): SearchToolDeps {
  return visionToolDeps(tool, { ...realSearchToolDeps(), models: () => DesignMedia.visionTools(), install: name => DesignMedia.installVisionModel(name) });
}
