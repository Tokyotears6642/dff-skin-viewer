import * as THREE from 'three';

function materialArray(material) {
  if (!material) {
    return [];
  }

  return Array.isArray(material) ? material : [material];
}

export function disposeObject3D(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }

    for (const material of materialArray(child.material)) {
      const textureKeys = ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'];
      for (const key of textureKeys) {
        if (material[key]?.dispose) {
          material[key].dispose();
        }
      }

      if (material.dispose) {
        material.dispose();
      }
    }
  });
}

export function applyWireframe(object, enabled) {
  if (!object) {
    return;
  }

  object.traverse((child) => {
    for (const material of materialArray(child.material)) {
      material.wireframe = enabled;
      material.needsUpdate = true;
    }
  });
}

export function collectModelStats(object, textureDictionary, dffFile, txdFile) {
  const materialNames = new Set();
  const textureNames = textureDictionary ? [...textureDictionary.keys()] : [];
  let meshCount = 0;
  let skinnedMeshCount = 0;
  let materialCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;

  object.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) {
      return;
    }

    meshCount += 1;
    if (child.isSkinnedMesh) {
      skinnedMeshCount += 1;
    }

    const geometry = child.geometry;
    const position = geometry?.getAttribute('position');
    if (position) {
      vertexCount += position.count;
      triangleCount += Math.floor(position.count / 3);
    }

    for (const material of materialArray(child.material)) {
      materialCount += 1;

      if (material.name) {
        materialNames.add(material.name);
      } else if (material.map?.name) {
        materialNames.add(material.map.name);
      } else {
        materialNames.add(`Material ${materialCount}`);
      }
    }
  });

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);

  return {
    dffFile,
    txdFile,
    meshCount,
    skinnedMeshCount,
    materialCount,
    vertexCount,
    triangleCount,
    textureCount: textureNames.length,
    materialNames: [...materialNames].slice(0, 32),
    textureNames: textureNames.slice(0, 32),
    bounds: {
      x: Number(size.x.toFixed(3)),
      y: Number(size.y.toFixed(3)),
      z: Number(size.z.toFixed(3))
    }
  };
}
