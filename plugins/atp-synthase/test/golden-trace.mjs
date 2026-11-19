// Records everything observable from a player so two implementations can be compared exactly.
export const TIMES = [0, 0.5, 1, 2, 4, 6, 11.3, 40, 120];
const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => v instanceof Map ? [...v.entries()] : v));
export function trace(player) {
  const snapshots = TIMES.map((time) => plain(player.seek(time)));
  player.seek(1.3);
  return plain({
    steps: player.steps, navigation: player.navigation, duration: player.duration,
    particleParentId: player.particleParentId, membrane: player.membrane,
    snapshots, stepTimes: [0, 1, 2, 3, 4].map((i) => player.stepTime(i)),
    saved: player.save(),
  });
}
