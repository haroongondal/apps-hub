import type { PhotoModel, SearchToolDeps, SearchToolResult } from './search-tool.ts';

export type VisionTool = 'person' | 'object' | 'upscale';
export type VisionModel = PhotoModel & { tool: string };
// Same ports as the photo-search download, except models() lists every tool's model.
export type VisionBaseDeps = Omit<SearchToolDeps, 'models'> & { models(): Promise<VisionModel[]> };

// Pass the result to getSearchTool: it then fetches only the model this tool needs.
export function visionToolDeps(tool: VisionTool, base: VisionBaseDeps): SearchToolDeps {
  return { ...base, models: async () => (await base.models()).filter(m => m.tool === tool) };
}

export function visionToolMessage(r: SearchToolResult): string | null {
  if (r === 'offline') return 'Connect to the internet once to get this tool.';
  if (r === 'no-room') return "There isn't enough free space for this tool. Free up some space and try again.";
  if (r === 'bad-download') return "The download didn't finish properly. Try again.";
  return null;
}
