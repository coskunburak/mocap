export class Vector3 {
  constructor(public x: number, public y: number, public z: number) {}

  add(v: Vector3): Vector3 {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v: Vector3): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  multiplyScalar(s: number): Vector3 {
    return new Vector3(this.x * s, this.y * s, this.z * s);
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize(): Vector3 {
    const len = this.length();
    if (len === 0) return new Vector3(0, 0, 0);
    return new Vector3(this.x / len, this.y / len, this.z / len);
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vector3): Vector3 {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }
}

export class Quaternion {
  constructor(public x: number, public y: number, public z: number, public w: number) {}

  static identity(): Quaternion {
    return new Quaternion(0, 0, 0, 1);
  }

  static fromEuler(x: number, y: number, z: number, order = "ZXY"): Quaternion {
    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);

    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);

    if (order === "ZXY") {
      return new Quaternion(
        s1 * c2 * c3 - c1 * s2 * s3,
        c1 * s2 * c3 + s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
        c1 * c2 * c3 - s1 * s2 * s3
      );
    }
    // Default XYZ fallback
    return new Quaternion(
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3
    );
  }

  static fromVectors(u: Vector3, v: Vector3): Quaternion {
    const a = u.normalize();
    const b = v.normalize();
    const dot = a.dot(b);

    if (dot < -0.999999) {
      let axis = new Vector3(1, 0, 0).cross(a);
      if (axis.length() < 0.000001) axis = new Vector3(0, 1, 0).cross(a);
      axis = axis.normalize();
      return new Quaternion(axis.x, axis.y, axis.z, 0);
    } else if (dot > 0.999999) {
      return new Quaternion(0, 0, 0, 1);
    } else {
      const cross = a.cross(b);
      const w = 1 + dot;
      const q = new Quaternion(cross.x, cross.y, cross.z, w);
      return q.normalize();
    }
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }

  normalize(): Quaternion {
    const len = this.length();
    if (len === 0) return new Quaternion(0, 0, 0, 1);
    return new Quaternion(this.x / len, this.y / len, this.z / len, this.w / len);
  }

  multiply(q: Quaternion): Quaternion {
    return new Quaternion(
      this.x * q.w + this.w * q.x + this.y * q.z - this.z * q.y,
      this.y * q.w + this.w * q.y + this.z * q.x - this.x * q.z,
      this.z * q.w + this.w * q.z + this.x * q.y - this.y * q.x,
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z
    );
  }

  invert(): Quaternion {
    return new Quaternion(-this.x, -this.y, -this.z, this.w);
  }

  // Returns Euler angles (in radians) as Z, X, Y
  toEulerZXY(): { x: number; y: number; z: number } {
    const x = Math.asin(Math.max(-1, Math.min(1, 2 * (this.w * this.x + this.y * this.z))));
    const y = Math.atan2(2 * (this.w * this.y - this.x * this.z), 1 - 2 * (this.x * this.x + this.y * this.y));
    const z = Math.atan2(2 * (this.w * this.z - this.x * this.y), 1 - 2 * (this.x * this.x + this.z * this.z));
    return { x, y, z };
  }
}
