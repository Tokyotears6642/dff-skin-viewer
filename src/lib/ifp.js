class BinaryReader {
  constructor(arrayBuffer) {
    this.view = new DataView(arrayBuffer);
    this.offset = 0;
  }

  seek(bytes) {
    this.offset += bytes;
  }

  readInt16() {
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readInt32() {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUint32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readString(maxLength) {
    const chars = [];
    let consumed = 0;

    while (consumed < maxLength) {
      const byte = this.view.getUint8(this.offset + consumed);
      consumed += 1;
      if (byte === 0) {
        break;
      }
      chars.push(String.fromCharCode(byte));
    }

    this.offset += maxLength;
    return chars.join('');
  }
}

function align4(length) {
  return (4 - (length % 4)) % 4;
}

function readAnp3Bone(reader) {
  const name = reader.readString(24);
  const rawKeyframeType = reader.readUint32();
  const keyframesCount = reader.readUint32();
  const keyframeType = rawKeyframeType === 4 ? 'KRT0' : 'KR00';
  const boneId = reader.readInt32();
  const hasTranslation = keyframeType[2] === 'T';
  const keyframes = [];

  for (let index = 0; index < keyframesCount; index += 1) {
    const qx = reader.readInt16();
    const qy = reader.readInt16();
    const qz = reader.readInt16();
    const qw = reader.readInt16();
    const time = reader.readInt16();
    const px = hasTranslation ? reader.readInt16() : 0;
    const py = hasTranslation ? reader.readInt16() : 0;
    const pz = hasTranslation ? reader.readInt16() : 0;

    keyframes.push({
      time,
      position: [px / 1024, py / 1024, pz / 1024],
      rotation: [qx / 4096, qy / 4096, qz / 4096, qw / 4096],
      scale: [1, 1, 1]
    });
  }

  return {
    name,
    keyframeType,
    useBoneId: true,
    boneId,
    siblingX: 0,
    siblingY: 0,
    keyframes
  };
}

function readAnp3Animation(reader) {
  const name = reader.readString(24);
  const bonesCount = reader.readUint32();
  reader.readUint32();
  reader.readUint32();

  return {
    name,
    bones: Array.from({ length: bonesCount }, () => readAnp3Bone(reader))
  };
}

function readAnp3(reader) {
  reader.readUint32();
  const name = reader.readString(24);
  const animationsCount = reader.readUint32();

  return {
    name,
    animations: Array.from({ length: animationsCount }, () => readAnp3Animation(reader))
  };
}

function readAnpkBone(reader) {
  reader.seek(4);
  const boneLength = reader.readUint32();
  const boneEnd = reader.offset + boneLength;
  reader.seek(4);
  const animLength = reader.readUint32();
  const name = reader.readString(28);
  const keyframesCount = reader.readUint32();
  reader.seek(8);

  let boneId = -1;
  let siblingX = 0;
  let siblingY = 0;
  let useBoneId = false;

  if (animLength === 44) {
    boneId = reader.readInt32();
    useBoneId = true;
  } else {
    siblingX = reader.readInt32();
    siblingY = reader.readInt32();
  }

  let keyframeType = 'K000';
  const keyframes = [];

  if (keyframesCount > 0) {
    keyframeType = reader.readString(4);
    reader.readUint32();

    for (let index = 0; index < keyframesCount; index += 1) {
      const qx = reader.readFloat32();
      const qy = reader.readFloat32();
      const qz = reader.readFloat32();
      const qw = reader.readFloat32();
      const px = keyframeType[2] === 'T' ? reader.readFloat32() : 0;
      const py = keyframeType[2] === 'T' ? reader.readFloat32() : 0;
      const pz = keyframeType[2] === 'T' ? reader.readFloat32() : 0;
      const sx = keyframeType[3] === 'S' ? reader.readFloat32() : 1;
      const sy = keyframeType[3] === 'S' ? reader.readFloat32() : 1;
      const sz = keyframeType[3] === 'S' ? reader.readFloat32() : 1;
      const time = reader.readFloat32();

      keyframes.push({
        time,
        position: [px, py, pz],
        rotation: [-qx, -qy, -qz, qw],
        scale: [sx, sy, sz]
      });
    }
  }

  if (reader.offset < boneEnd) {
    reader.offset = boneEnd;
  }

  return {
    name,
    keyframeType,
    useBoneId,
    boneId,
    siblingX,
    siblingY,
    keyframes
  };
}

function readAnpkAnimation(reader) {
  reader.seek(4);
  const nameLength = reader.readUint32();
  const name = reader.readString(nameLength);
  reader.seek(align4(nameLength));
  reader.seek(4);
  reader.readUint32();
  reader.seek(4);
  const infoLength = reader.readUint32();
  const bonesCount = reader.readUint32();
  reader.seek(infoLength - 4);

  return {
    name,
    bones: Array.from({ length: bonesCount }, () => readAnpkBone(reader))
  };
}

function readAnpk(reader) {
  reader.readUint32();
  reader.seek(4);
  const infoLength = reader.readUint32();
  const animationsCount = reader.readUint32();
  const name = reader.readString(infoLength - 4);
  reader.seek(align4(infoLength));

  return {
    name,
    animations: Array.from({ length: animationsCount }, () => readAnpkAnimation(reader))
  };
}

export function parseIfp(arrayBuffer) {
  const reader = new BinaryReader(arrayBuffer);
  const version = reader.readString(4);

  if (version === 'ANP3') {
    return {
      version,
      data: readAnp3(reader)
    };
  }

  if (version === 'ANPK') {
    return {
      version,
      data: readAnpk(reader)
    };
  }

  throw new Error(`Version IFP no soportada: ${version || 'desconocida'}`);
}

export function getIfpSummary(ifpData) {
  const animations = ifpData?.data?.animations ?? [];

  return {
    version: ifpData?.version ?? '',
    name: ifpData?.data?.name ?? '',
    animationCount: animations.length,
    animations: animations.map((animation) => ({
      name: animation.name,
      boneCount: animation.bones.length,
      duration: (() => {
        const rawDuration = Math.max(
          0,
          ...animation.bones.flatMap((bone) => bone.keyframes.map((keyframe) => keyframe.time))
        );
        return rawDuration > 20 ? rawDuration / 30 : rawDuration;
      })()
    }))
  };
}
