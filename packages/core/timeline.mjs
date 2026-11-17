function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function cloneTransform(transform) {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

function interpolate(a, b, amount) {
  const lerp3 = (left, right) => left.map((value, i) => value * (1 - amount) + right[i] * amount);
  const qa = a.rotation;
  let qb = b.rotation;
  let dot = qa.reduce((sum, value, i) => sum + value * qb[i], 0);
  if (dot < 0) {
    qb = qb.map(value => -value);
    dot = -dot;
  }
  let rotation;
  if (dot > 0.9995) {
    rotation = qa.map((value, i) => value + (qb[i] - value) * amount);
  } else {
    const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
    const sinTheta = Math.sin(theta);
    const wa = Math.sin((1 - amount) * theta) / sinTheta;
    const wb = Math.sin(amount * theta) / sinTheta;
    rotation = qa.map((value, i) => wa * value + wb * qb[i]);
  }
  const norm = Math.hypot(...rotation);
  rotation = rotation.map(value => value / norm);
  return { position: lerp3(a.position, b.position), rotation, scale: lerp3(a.scale, b.scale) };
}

function sampleTrack(track, time) {
  const frames = track.keyframes;
  if (time <= frames[0].time) return cloneTransform(frames[0].transform);
  const last = frames[frames.length - 1];
  if (time >= last.time) return cloneTransform(last.transform);
  let upper = 1;
  while (frames[upper].time < time) upper++;
  const before = frames[upper - 1];
  const after = frames[upper];
  if (time === after.time) return cloneTransform(after.transform);
  return interpolate(before.transform, after.transform, (time - before.time) / (after.time - before.time));
}

export function createTimeline({ duration, tracks }) {
  let time = 0;
  let playing = false;
  return {
    get duration() { return duration; },
    get time() { return time; },
    get playing() { return playing; },
    play() {
      if (time < duration) playing = true;
    },
    pause() { playing = false; },
    seek(seconds) {
      finite(seconds, 'seconds');
      time = Math.min(duration, Math.max(0, seconds));
      if (time === duration) playing = false;
    },
    advance(delta) {
      finite(delta, 'delta');
      if (!playing || delta <= 0) return;
      time = Math.min(duration, time + delta);
      if (time >= duration) playing = false;
    },
    sample() {
      const pose = new Map();
      for (const track of tracks) pose.set(track.nodeId, sampleTrack(track, time));
      return pose;
    },
  };
}
