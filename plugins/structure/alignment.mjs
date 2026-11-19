export function rotateVector([x, y, z], [qx, qy, qz, qw]) {
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

export const centroid = (points) => {
  const sum = [0, 0, 0];
  for (const point of points) for (let i = 0; i < 3; i++) sum[i] += point[i];
  return sum.map((value) => value / Math.max(1, points.length));
};

// Horn's quaternion fit, as used by the classic Viewer's beta-state alignment.
export function superpose(target, source) {
  if (target.length !== source.length || target.length < 3) throw new Error('构象对齐至少需要三对坐标。');
  const ca = centroid(target), cb = centroid(source);
  const s = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let n = 0; n < target.length; n++) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s[i][j] += (source[n][i] - cb[i]) * (target[n][j] - ca[j]);
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = s;
  const matrix = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const vectors = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => Number(i === j)));
  for (let sweep = 0; sweep < 32; sweep++) {
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(matrix[p][q]) < 1e-12) continue;
      const angle = 0.5 * Math.atan2(2 * matrix[p][q], matrix[q][q] - matrix[p][p]);
      const c = Math.cos(angle), sn = Math.sin(angle);
      for (let k = 0; k < 4; k++) {
        [matrix[k][p], matrix[k][q]] = [c * matrix[k][p] - sn * matrix[k][q], sn * matrix[k][p] + c * matrix[k][q]];
        [vectors[k][p], vectors[k][q]] = [c * vectors[k][p] - sn * vectors[k][q], sn * vectors[k][p] + c * vectors[k][q]];
      }
      for (let k = 0; k < 4; k++) {
        [matrix[p][k], matrix[q][k]] = [c * matrix[p][k] - sn * matrix[q][k], sn * matrix[p][k] + c * matrix[q][k]];
      }
    }
  }
  const eigenvalues = matrix.map((row, i) => row[i]);
  const index = eigenvalues.indexOf(Math.max(...eigenvalues));
  const [w, x, y, z] = vectors.map((row) => row[index]);
  const quaternion = [x, y, z, w];
  return (point) => rotateVector(point.map((value, i) => value - cb[i]), quaternion).map((value, i) => value + ca[i]);
}
