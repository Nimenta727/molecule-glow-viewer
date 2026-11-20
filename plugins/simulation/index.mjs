import { DATA_TOOL, dataToolDescriptor } from './data-tool.mjs';
import { PROCESS_TOOL, processToolDescriptor } from './process-tool.mjs';

export const SIMULATION_PLUGIN = 'org.glow.simulation';
/**
 * The simulation plugin (physical package of CONTRACT_4.3.0 §3; gating/kinetics and sequence processes join it later). First tool: the data animation
 * (compartments, species, pools, flows and reactions as plain data) and the stochastic process (a Markov chain as plain data). It registers data only; the Viewer draws and runs it, Studio edits its configuration.
 */
export const simulationPlugin = {
  manifest: { id: SIMULATION_PLUGIN, version: '1.0.0', apiVersion: 1,
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }], capabilities: ['tools'] },
  activate(context) {
    context.registerTool(DATA_TOOL, dataToolDescriptor(this.manifest.version));
    context.registerTool(PROCESS_TOOL, processToolDescriptor(this.manifest.version));
  },
};
export { DATA_TOOL, PROCESS_TOOL };
