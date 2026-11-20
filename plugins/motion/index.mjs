import { SOLUTION_TOOL, solutionToolDescriptor } from './solution-tool.mjs';

export const MOTION_PLUGIN = 'org.glow.motion';
/**
 * The motion plugin (physical package of CONTRACT_4.3.0 §3; the conformation, spin and path algorithms in this folder join it as they become tools). First
 * tool: the solution particles. It registers data only: the Viewer draws the layer, Studio edits the configuration.
 */
export const motionPlugin = {
  manifest: { id: MOTION_PLUGIN, version: '1.0.0', apiVersion: 1,
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }], capabilities: ['tools'] },
  activate(context) { context.registerTool(SOLUTION_TOOL, solutionToolDescriptor(this.manifest.version)); },
};
export { SOLUTION_TOOL };
