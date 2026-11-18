const transform = (position, scale = [1, 1, 1]) => ({ position, rotation: [0, 0, 0, 1], scale });
const node = (id, name, parentId, assetId, position, scale) => ({
  id, name, parentId, assetId, visible: true, transform: transform(position, scale),
});
const primitive = (id, shape, color) => ({ id, kind: 'primitive', shape, color });
const cargo = (time, position) => ({ time, transform: transform(position, [0.27, 0.27, 0.27]) });

export const fourModesDemo = {
  format: 'glow-scene',
  schemaVersion: 2,
  id: 'four-modes-demo',
  title: '示意场景 · 虚构细胞中的颗粒传递',
  units: { length: 'meter', time: 'second' },
  assets: [
    primitive('boundary', 'sphere', '#b3d1d6'),
    primitive('region', 'sphere', '#d4e5cf'),
    primitive('platform', 'box', '#527e91'),
    primitive('component', 'sphere', '#388775'),
    primitive('site', 'sphere', '#8063b4'),
    primitive('cargo', 'sphere', '#ef9d42'),
  ],
  nodes: [
    node('cell', '示意细胞', null, null, [0, 0, 0]),
    node('boundary', '细胞边界底座', 'cell', 'boundary', [0, -0.58, 0], [9, 0.6, 6]),
    node('region', '传递区', 'cell', null, [1, 0, 0]),
    node('region-floor', '传递区底座', 'region', 'region', [0, -0.24, 0], [4.4, 0.36, 3.2]),
    node('system', '颗粒传递系统', 'region', null, [0, 0, 0]),
    node('sender', '起点', 'system', 'platform', [-1.35, 0.12, 0], [0.55, 0.25, 0.6]),
    node('receiver', '终点', 'system', 'platform', [1.35, 0.12, 0], [0.55, 0.25, 0.6]),
    node('protein', '示意蛋白质', 'system', null, [0, 0.1, 0]),
    node('base-part', '支撑部件', 'protein', 'component', [0, 0, 0], [1.05, 0.5, 0.8]),
    node('side-part', '侧部件', 'protein', 'component', [0, 0.32, -0.25], [0.65, 0.62, 0.46]),
    node('binding-site', '示意接触点', 'protein', 'site', [0, 0.34, 0.23], [0.32, 0.32, 0.32]),
    node('particle', '示意颗粒', 'system', 'cargo', [-1.35, 0.4, 0], [0.27, 0.27, 0.27]),
  ],
  timeline: {
    duration: 4,
    tracks: [{ nodeId: 'particle', keyframes: [
      cargo(0, [-1.35, 0.4, 0]), cargo(2, [0, 0.57, 0.30]), cargo(4, [1.35, 0.4, 0]),
    ] }],
  },
  dependencies: [],
  evidence: [{ type: 'illustrative', citation: '虚构教学场景。几何、尺度与运动只用于演示，无实验结构或反应数据。' }],
  presentation: {
    notes: [
      { id: 'label-region', nodeId: 'region', text: '传递区：局部系统的入口。' },
      { id: 'label-system', nodeId: 'system', text: '橙色颗粒在起点与终点之间移动。' },
      { id: 'label-protein', nodeId: 'protein', text: '示意蛋白质由通用几何部件组成。' },
      { id: 'label-site', nodeId: 'binding-site', text: '紫色球体是示意接触点。' },
    ],
    bookmarks: [
      { id: 'camera-cell', name: '细胞总览', position: [7, 8, 10], target: [0, 0, 0] },
      { id: 'camera-system', name: '局部系统', position: [4, 3.8, 5.4], target: [1, 0.2, 0] },
      { id: 'camera-protein', name: '蛋白质部件', position: [2.1, 1.7, 2.5], target: [1, 0.3, 0] },
    ],
    navigation: {
      version: 1,
      entryId: 'view-cell',
      views: [
        { id: 'view-cell', mode: 'cell', title: '示意细胞', nodeId: 'cell', parentIds: [],
          bookmarkId: 'camera-cell', labelIds: ['label-region'] },
        { id: 'view-system', mode: 'system', title: '颗粒传递系统', nodeId: 'system', parentIds: ['view-cell'],
          hotspotNodeId: 'region', bookmarkId: 'camera-system', labelIds: ['label-system', 'label-protein'] },
        { id: 'view-protein', mode: 'protein', title: '示意蛋白质', nodeId: 'protein', parentIds: ['view-system'],
          hotspotNodeId: 'protein', bookmarkId: 'camera-protein', labelIds: ['label-protein', 'label-site'] },
        { id: 'view-mechanism', mode: 'mechanism', title: '示意颗粒传递步骤', nodeId: 'system',
          parentIds: ['view-system', 'view-protein'], bookmarkId: 'camera-system', labelIds: ['label-system', 'label-site'],
          steps: [
            { id: 'approach', title: '示意 · 从起点靠近', time: 0, nodeIds: ['particle', 'sender'] },
            { id: 'contact', title: '示意 · 接触', time: 2, nodeIds: ['particle', 'binding-site'] },
            { id: 'release', title: '示意 · 到达终点', time: 4, nodeIds: ['particle', 'receiver'] },
          ] },
      ],
    },
  },
};
