const transform = (position, scale = [1, 1, 1]) => ({ position, rotation: [0, 0, 0, 1], scale });

export const exampleScene = {
  format: 'glow-prototype',
  version: 1,
  assets: [
    { id: 'box', kind: 'primitive', shape: 'box', color: '#2a866f' },
    { id: 'sphere', kind: 'primitive', shape: 'sphere', color: '#d58542' },
  ],
  nodes: [
    { id: 'group', name: '几何组合', parentId: null, assetId: null, visible: true, transform: transform([0, 0, 0]) },
    { id: 'left', name: '立方体', parentId: 'group', assetId: 'box', visible: true, transform: transform([-0.85, 0, 0]) },
    { id: 'right', name: '球体', parentId: 'group', assetId: 'sphere', visible: true, transform: transform([0.85, 0, 0]) },
  ],
  timeline: {
    duration: 4,
    tracks: [{
      nodeId: 'right',
      keyframes: [
        { time: 0, transform: transform([0.85, 0, 0]) },
        { time: 2, transform: transform([0.85, 0.8, 0]) },
        { time: 4, transform: transform([0.85, 0, 0]) },
      ],
    }],
  },
};
