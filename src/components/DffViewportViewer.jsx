import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { DFFLoader, TXDLoader } from 'dff-loader';
import { applyWireframe, collectModelStats, disposeObject3D } from '../lib/modelStats.js';
import {
  createTexturePreviews,
  disposeTextureDictionary,
  normalizeTextureDictionary
} from '../lib/renderwareTextures.js';

function materialArray(material) {
  if (!material) {
    return [];
  }

  return Array.isArray(material) ? material : [material];
}

const headNameTokens = ['head', 'face', 'hair', 'beard', 'eye'];
const footNameTokens = ['shoe', 'foot', 'feet', 'boot', 'sneak', 'bask', 'blackaf', 'pantshoe'];

function semanticName(value = '') {
  return String(value).toLowerCase();
}

function materialSemanticType(material) {
  const name = semanticName(`${material?.map?.name ?? ''} ${material?.name ?? ''}`);
  if (headNameTokens.some((token) => name.includes(token))) {
    return 'head';
  }
  if (footNameTokens.some((token) => name.includes(token))) {
    return 'foot';
  }
  return '';
}

function getGroupYStats(mesh, group) {
  const geometry = mesh.geometry;
  const position = geometry?.getAttribute('position');
  if (!position) {
    return null;
  }

  const index = geometry.index;
  const sourceCount = index?.count ?? position.count;
  const start = Math.max(0, group?.start ?? 0);
  const count = Math.max(0, group?.count ?? sourceCount);
  const end = Math.min(sourceCount, start + count);
  const stride = Math.max(1, Math.floor(Math.max(1, end - start) / 1200));
  const vertex = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  let sumY = 0;
  let samples = 0;

  for (let i = start; i < end; i += stride) {
    const vertexIndex = index ? index.getX(i) : i;
    vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld);
    minY = Math.min(minY, vertex.y);
    maxY = Math.max(maxY, vertex.y);
    sumY += vertex.y;
    samples += 1;
  }

  if (samples === 0) {
    return null;
  }

  return {
    minY,
    maxY,
    avgY: sumY / samples
  };
}

function semanticUprightScore(object) {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return 0;
  }

  const center = new THREE.Vector3();
  box.getCenter(center);
  let headY = 0;
  let headCount = 0;
  let footY = 0;
  let footCount = 0;

  object.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) {
      return;
    }

    const materials = materialArray(child.material);
    const geometry = child.geometry;
    const sourceCount = geometry?.index?.count ?? geometry?.getAttribute('position')?.count ?? 0;
    const groups = geometry?.groups?.length
      ? geometry.groups
      : materials.map((_, index) => ({ start: 0, count: sourceCount, materialIndex: index }));

    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      const semanticType = materialSemanticType(material);
      if (!semanticType) {
        continue;
      }

      const stats = getGroupYStats(child, group);
      if (!stats) {
        continue;
      }

      if (semanticType === 'head') {
        headY += stats.maxY;
        headCount += 1;
      } else if (semanticType === 'foot') {
        footY += stats.minY;
        footCount += 1;
      }
    }
  });

  let score = 0;
  if (headCount > 0) {
    score += ((headY / headCount) - center.y) * 2.2;
  }
  if (footCount > 0) {
    score += (center.y - (footY / footCount)) * 1.4;
  }
  if (headCount > 0 && footCount > 0) {
    score += ((headY / headCount) - (footY / footCount)) * 2.6;
  }

  return score;
}

function inferMaterialName(material, index) {
  return material.map?.name || material.name || `material_${index + 1}`;
}

function collectMaterialControls(object, texturePreviews) {
  const texturePreviewByName = new Map(texturePreviews.map((preview) => [preview.name.toLowerCase(), preview]));
  const materialEntries = [];
  let materialIndex = 0;

  object.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) {
      return;
    }

    materialArray(child.material).forEach((material, slotIndex) => {
      const rawName = inferMaterialName(material, materialIndex);
      const baseName = rawName.trim() || `material_${materialIndex + 1}`;
      const id = `${child.uuid}:${slotIndex}`;
      const color = material.color ? `#${material.color.getHexString()}` : '#ffffff';
      const texturePreview = texturePreviewByName.get(baseName.toLowerCase());

      material.userData.viewerMaterialId = id;
      material.name = baseName;

      materialEntries.push({
        id,
        baseName,
        displayName: baseName,
        slotIndex,
        meshName: child.name || `Mesh ${materialIndex + 1}`,
        textureName: material.map?.name || '',
        color,
        previewDataUrl: texturePreview?.dataUrl ?? '',
        visible: material.visible !== false
      });

      materialIndex += 1;
    });
  });

  const duplicates = new Map();
  for (const material of materialEntries) {
    const key = material.baseName.toLowerCase();
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
  }

  const duplicateIndexes = new Map();
  return materialEntries.map((material) => {
    const key = material.baseName.toLowerCase();
    const count = duplicates.get(key) ?? 1;

    if (count === 1) {
      return material;
    }

    const index = (duplicateIndexes.get(key) ?? 0) + 1;
    duplicateIndexes.set(key, index);

    return {
      ...material,
      displayName: `${material.baseName} (${index})`
    };
  });
}

function tuneMaterials(object) {
  object.traverse((child) => {
    for (const material of materialArray(child.material)) {
      material.side = THREE.DoubleSide;
      material.flatShading = false;

      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.flipY = false;
        material.map.needsUpdate = true;
      }

      if (material.alphaMap) {
        material.alphaMap.flipY = false;
        material.alphaMap.needsUpdate = true;
      }

      material.needsUpdate = true;
    }
  });
}

function vertexPositionKey(position, index) {
  return [
    Math.round(position.getX(index) * 10000),
    Math.round(position.getY(index) * 10000),
    Math.round(position.getZ(index) * 10000)
  ].join('|');
}

function clearSharpGeometry(geometry) {
  const position = geometry?.getAttribute('position');
  if (!position || position.count < 3) {
    return;
  }

  const index = geometry.index;
  const sourceCount = index?.count ?? position.count;
  const normalsByPosition = new Map();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  for (let i = 0; i + 2 < sourceCount; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;

    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    cb.subVectors(c, b);
    ab.subVectors(a, b);
    faceNormal.crossVectors(cb, ab);

    if (faceNormal.lengthSq() === 0) {
      continue;
    }

    for (const vertexIndex of [ia, ib, ic]) {
      const key = vertexPositionKey(position, vertexIndex);
      const normal = normalsByPosition.get(key) ?? new THREE.Vector3();
      normal.add(faceNormal);
      normalsByPosition.set(key, normal);
    }
  }

  for (const normal of normalsByPosition.values()) {
    normal.normalize();
  }

  let normalAttribute = geometry.getAttribute('normal');
  if (!normalAttribute || normalAttribute.count !== position.count) {
    normalAttribute = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
    geometry.setAttribute('normal', normalAttribute);
  }

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    const normal = normalsByPosition.get(vertexPositionKey(position, vertexIndex));
    if (normal) {
      normalAttribute.setXYZ(vertexIndex, normal.x, normal.y, normal.z);
    }
  }

  normalAttribute.needsUpdate = true;
}

function clearSharpPreview(object) {
  object.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) {
      return;
    }

    clearSharpGeometry(child.geometry);
    for (const material of materialArray(child.material)) {
      material.flatShading = false;
      material.needsUpdate = true;
    }
  });
}

function normalizeObject(object) {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    return;
  }

  const center = new THREE.Vector3();
  box.getCenter(center);

  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
}

function uprightScore(size) {
  return size.y - Math.max(size.x, size.z) * 0.55;
}

function autoOrientObject(object) {
  object.updateMatrixWorld(true);

  const originalQuaternion = object.quaternion.clone();
  const baseBox = new THREE.Box3().setFromObject(object);
  if (baseBox.isEmpty()) {
    return false;
  }

  const baseSize = new THREE.Vector3();
  baseBox.getSize(baseSize);
  const baseScore = uprightScore(baseSize) + semanticUprightScore(object);
  let best = {
    score: baseScore,
    quaternion: originalQuaternion.clone(),
    size: baseSize.clone()
  };

  const candidates = [
    { axis: 'x', angle: -Math.PI / 2 },
    { axis: 'x', angle: Math.PI / 2 },
    { axis: 'z', angle: -Math.PI / 2 },
    { axis: 'z', angle: Math.PI / 2 }
  ];

  for (const candidate of candidates) {
    object.quaternion.copy(originalQuaternion);
    if (candidate.axis === 'x') {
      object.rotateX(candidate.angle);
    } else {
      object.rotateZ(candidate.angle);
    }
    object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);
    const score = uprightScore(size) + semanticUprightScore(object);

    if (score > best.score) {
      best = {
        score,
        quaternion: object.quaternion.clone(),
        size
      };
    }
  }

  const baseLongestHorizontal = Math.max(baseSize.x, baseSize.z);
  const bestLongestHorizontal = Math.max(best.size.x, best.size.z);
  const shouldRotate =
    best.score > baseScore + 0.05 &&
    best.size.y > baseSize.y * 1.18 &&
    best.size.y >= bestLongestHorizontal * 0.8 &&
    baseSize.y < baseLongestHorizontal * 0.9;

  object.quaternion.copy(shouldRotate ? best.quaternion : originalQuaternion);
  object.updateMatrixWorld(true);
  return shouldRotate;
}

function fitCameraToObject(camera, controls, object, renderer, grid) {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    camera.position.set(2.2, 1.7, 2.6);
    controls.target.set(0, 0.9, 0);
    controls.update();
    return;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxSize = Math.max(size.x, size.y, size.z, 0.1);
  const distance = (maxSize * 0.58) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const aspectOffset = renderer.domElement.clientWidth < 860 ? 1.3 : 1;

  camera.position.set(center.x, center.y + distance * 0.08, center.z + distance * 1.12 * aspectOffset);
  camera.near = Math.max(distance / 120, 0.01);
  camera.far = Math.max(distance * 120, 100);
  camera.updateProjectionMatrix();

  controls.target.set(center.x, center.y + size.y * 0.03, center.z);
  controls.minDistance = Math.max(maxSize * 0.08, 0.05);
  controls.maxDistance = Math.max(distance * 8, 10);
  controls.update();

  if (grid) {
    const gridSize = Math.max(maxSize * 3.5, 4);
    grid.scale.setScalar(gridSize / 10);
    grid.position.y = 0;
  }
}

function resetModelRootTransform(viewer) {
  if (!viewer?.modelRoot) {
    return;
  }

  viewer.modelRoot.position.set(0, 0, 0);
  viewer.modelRoot.rotation.set(0, 0, 0);
  viewer.modelRoot.scale.set(1, 1, 1);
  viewer.modelRoot.updateMatrixWorld(true);
}

function removeBoneHelpers(viewer) {
  if (!viewer?.boneHelpers) {
    return;
  }

  for (const helper of viewer.boneHelpers) {
    helper.parent?.remove(helper);
    helper.geometry?.dispose();
    helper.material?.dispose();
  }

  viewer.boneHelpers = [];
}

function updateBoneHelpers(viewer, visible) {
  removeBoneHelpers(viewer);

  if (!visible || !viewer?.modelRoot) {
    return;
  }

  let hasBones = false;
  viewer.modelRoot.traverse((child) => {
    if (child.isBone || (child.isSkinnedMesh && child.skeleton?.bones?.length)) {
      hasBones = true;
    }
  });

  if (!hasBones) {
    return;
  }

  const helper = new THREE.SkeletonHelper(viewer.modelRoot);
  helper.material.color.set(0x7fc4ff);
  helper.material.depthTest = false;
  helper.material.transparent = true;
  helper.material.opacity = 0.92;
  helper.renderOrder = 20;
  viewer.scene.add(helper);
  viewer.boneHelpers.push(helper);
}

function attachTransform(viewer) {
  if (!viewer?.transformControls) {
    return;
  }

  if (viewer.transformEnabled && viewer.model && viewer.modelRoot) {
    viewer.transformControls.attach(viewer.modelRoot);
    viewer.transformHelper.visible = true;
    viewer.transformControls.enabled = true;
    viewer.transformControls.setMode(viewer.transformMode);
  } else {
    viewer.transformControls.detach();
    viewer.transformHelper.visible = false;
    viewer.transformControls.enabled = false;
  }
}

function getModelBox(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center };
}

function straightenModel(viewer) {
  if (!viewer?.modelRoot) {
    return;
  }

  const { size } = getModelBox(viewer.modelRoot);
  if (size.x > size.y * 1.2) {
    viewer.modelRoot.rotation.z += Math.PI / 2;
  } else if (size.z > size.y * 1.2) {
    viewer.modelRoot.rotation.x -= Math.PI / 2;
  }

  viewer.modelRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(viewer.modelRoot);
  if (!box.isEmpty()) {
    viewer.modelRoot.position.y -= box.min.y;
  }
  viewer.modelRoot.updateMatrixWorld(true);
  fitCameraToObject(viewer.camera, viewer.controls, viewer.modelRoot, viewer.renderer, viewer.grid);
  attachTransform(viewer);
}

function disposeTextureOverride(material) {
  const overrideTexture = material?.userData?.viewerTextureOverride;
  if (overrideTexture?.dispose) {
    overrideTexture.dispose();
  }

  if (material?.userData) {
    material.userData.viewerTextureOverride = null;
  }
}

function clearMaterialTextureOverride(viewer, materialId) {
  const material = viewer?.materialById?.get(materialId);
  if (!material) {
    return false;
  }

  disposeTextureOverride(material);
  if (Object.prototype.hasOwnProperty.call(material.userData, 'viewerOriginalMap')) {
    material.map = material.userData.viewerOriginalMap;
  }
  material.needsUpdate = true;
  viewer.textureOverrideByMaterialId?.delete(materialId);
  return true;
}

function clearMaterialTextureOverrides(viewer) {
  if (!viewer?.textureOverrideByMaterialId) {
    return;
  }

  for (const materialId of [...viewer.textureOverrideByMaterialId.keys()]) {
    clearMaterialTextureOverride(viewer, materialId);
  }
}

async function applyMaterialTextureOverride(viewer, materialId, dataUrl) {
  const material = viewer?.materialById?.get(materialId);
  if (!material) {
    throw new Error('No se encontro el material seleccionado.');
  }

  const texture = await new THREE.TextureLoader().loadAsync(dataUrl);
  texture.name = material.map?.name || material.name || 'custom_logo_texture';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  if (!Object.prototype.hasOwnProperty.call(material.userData, 'viewerOriginalMap')) {
    material.userData.viewerOriginalMap = material.map ?? null;
  }

  disposeTextureOverride(material);
  material.userData.viewerTextureOverride = texture;
  material.map = texture;
  material.needsUpdate = true;
  viewer.textureOverrideByMaterialId.set(materialId, texture);
  return true;
}

function textureNameKey(value = '') {
  return String(value).toLowerCase().trim();
}

function materialMatchesTexture(material, textureName) {
  const key = textureNameKey(textureName);
  if (!key) {
    return false;
  }

  return [
    material?.map?.name,
    material?.userData?.viewerOriginalMap?.name,
    material?.name
  ].some((value) => textureNameKey(value) === key);
}

function findMaterialsByTextureName(viewer, textureName) {
  if (!viewer?.materialById) {
    return [];
  }

  const materials = [];
  for (const material of viewer.materialById.values()) {
    if (materialMatchesTexture(material, textureName) && !materials.includes(material)) {
      materials.push(material);
    }
  }
  return materials;
}

function clearTextureNameOverride(viewer, textureName) {
  const key = textureNameKey(textureName);
  const override = viewer?.textureOverrideByTextureName?.get(key);
  if (!override) {
    return false;
  }

  for (const [material, originalMap] of override.originalMaps.entries()) {
    material.map = originalMap;
    material.userData.viewerTextureOverride = null;
    material.needsUpdate = true;
  }

  override.texture?.dispose?.();
  viewer.textureOverrideByTextureName.delete(key);
  return true;
}

function clearTextureNameOverrides(viewer) {
  if (!viewer?.textureOverrideByTextureName) {
    return;
  }

  for (const textureName of [...viewer.textureOverrideByTextureName.keys()]) {
    clearTextureNameOverride(viewer, textureName);
  }
}

async function applyTextureNameOverride(viewer, textureName, dataUrl) {
  const materials = findMaterialsByTextureName(viewer, textureName);
  if (materials.length === 0) {
    return false;
  }

  clearTextureNameOverride(viewer, textureName);

  const texture = await new THREE.TextureLoader().loadAsync(dataUrl);
  texture.name = textureName;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const originalMaps = new Map();
  for (const material of materials) {
    originalMaps.set(material, material.map ?? null);
    disposeTextureOverride(material);
    viewer.textureOverrideByMaterialId?.delete(material.userData.viewerMaterialId);
    material.userData.viewerTextureOverride = texture;
    material.map = texture;
    material.needsUpdate = true;
  }

  viewer.textureOverrideByTextureName.set(textureNameKey(textureName), { texture, originalMaps });
  return true;
}

function normalizeBoneName(name = '') {
  return name.toLowerCase().replace(/\.[0-9]+$/, '').replace(/[^a-z0-9_ -]/g, '').trim();
}

function safeTrackName(name, fallback) {
  const cleaned = (name || fallback).replace(/[.[\]:/\\]/g, '_').trim();
  return cleaned || fallback;
}

function prepareAnimationBones(viewer) {
  const bones = [];
  const usedNames = new Map();
  const boneById = new Map();
  const boneByName = new Map();
  const restStates = new Map();

  viewer.model?.traverse((child) => {
    if (!child.isSkinnedMesh || !child.skeleton) {
      return;
    }

    child.skeleton.bones.forEach((bone, index) => {
      const originalName = bone.userData.ifpOriginalName || bone.name || `bone_${index}`;
      bone.userData.ifpOriginalName = originalName;

      let trackName = safeTrackName(originalName, `bone_${index}`);
      const count = usedNames.get(trackName) ?? 0;
      usedNames.set(trackName, count + 1);
      if (count > 0) {
        trackName = `${trackName}_${count + 1}`;
      }

      bone.name = trackName;
      bones.push(bone);

      if (bone.userData.nodeId !== undefined && bone.userData.nodeId !== null) {
        boneById.set(Number(bone.userData.nodeId), bone);
      }

      boneByName.set(normalizeBoneName(originalName), bone);
      boneByName.set(normalizeBoneName(trackName), bone);
      restStates.set(bone.uuid, {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone()
      });
    });
  });

  viewer.animationBones = bones;
  viewer.boneById = boneById;
  viewer.boneByName = boneByName;
  viewer.restBoneStates = restStates;
}

function resetAnimationPose(viewer) {
  if (!viewer?.restBoneStates) {
    return;
  }

  for (const bone of viewer.animationBones ?? []) {
    const rest = viewer.restBoneStates.get(bone.uuid);
    if (!rest) {
      continue;
    }

    bone.position.copy(rest.position);
    bone.quaternion.copy(rest.quaternion);
    bone.scale.copy(rest.scale);
  }
}

function findAnimationBone(viewer, ifpBone) {
  if (ifpBone.useBoneId && ifpBone.boneId !== -1 && viewer.boneById?.has(ifpBone.boneId)) {
    return viewer.boneById.get(ifpBone.boneId);
  }

  return viewer.boneByName?.get(normalizeBoneName(ifpBone.name)) ?? null;
}

function makeQuaternion(rotation) {
  return new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]).normalize();
}

function getAnimationTimeScale(animation) {
  const maxTime = Math.max(
    0,
    ...animation.bones.flatMap((bone) => bone.keyframes.map((keyframe) => keyframe.time))
  );

  return maxTime > 20 ? 1 / 30 : 1;
}

function canAnimateTranslation(targetBone, ifpBone) {
  const normalizedName = normalizeBoneName(targetBone.userData.ifpOriginalName || targetBone.name);
  return (
    !targetBone.parent ||
    ifpBone.boneId === 0 ||
    ifpBone.boneId === 1 ||
    normalizedName === 'root' ||
    normalizedName === 'pelvis'
  );
}

function createClipFromIfpAnimation(viewer, animation) {
  if (!viewer?.model || !animation) {
    return null;
  }

  const tracks = [];
  let matchedBones = 0;
  const keyedBoneCount = animation.bones.filter((bone) => bone.keyframes.length > 0).length;
  const skeletonBoneCount = viewer.animationBones?.length ?? 0;
  const minimumMatches = keyedBoneCount > 8 ? Math.max(3, Math.ceil(keyedBoneCount * 0.25)) : 1;
  const timeScale = getAnimationTimeScale(animation);

  if (
    keyedBoneCount > 8 &&
    skeletonBoneCount > 8 &&
    (skeletonBoneCount > keyedBoneCount * 1.35 || keyedBoneCount > skeletonBoneCount * 1.35)
  ) {
    return {
      clip: null,
      matchedBones: 0,
      error: `IFP bloqueada: skeleton incompatible (${skeletonBoneCount} bones DFF / ${keyedBoneCount} bones IFP).`
    };
  }

  for (const ifpBone of animation.bones) {
    const targetBone = findAnimationBone(viewer, ifpBone);
    if (!targetBone || ifpBone.keyframes.length === 0) {
      continue;
    }

    matchedBones += 1;
    const keyframes = [...ifpBone.keyframes].sort((a, b) => a.time - b.time);
    const firstKeyframe = keyframes[0];
    const startTime = firstKeyframe.time;
    const times = keyframes.map((keyframe) => Math.max((keyframe.time - startTime) * timeScale, 0));
    const hasTranslation = ifpBone.keyframeType[2] === 'T';
    const allowTranslation = hasTranslation && canAnimateTranslation(targetBone, ifpBone);
    const rest = viewer.restBoneStates.get(targetBone.uuid);
    const baseRotation = makeQuaternion(firstKeyframe.rotation);
    const quaternionValues = [];
    const positionValues = [];
    const basePosition = new THREE.Vector3(...firstKeyframe.position);
    let previousRotation = baseRotation.clone();
    let previousFinalRotation = rest?.quaternion?.clone() ?? targetBone.quaternion.clone();

    for (const keyframe of keyframes) {
      const quaternion = makeQuaternion(keyframe.rotation);
      if (previousRotation.dot(quaternion) < 0) {
        quaternion.x *= -1;
        quaternion.y *= -1;
        quaternion.z *= -1;
        quaternion.w *= -1;
      }
      previousRotation.copy(quaternion);

      const delta = baseRotation.clone().invert().multiply(quaternion).normalize();
      const finalQuaternion = rest?.quaternion
        ? rest.quaternion.clone().multiply(delta).normalize()
        : quaternion;

      if (previousFinalRotation.dot(finalQuaternion) < 0) {
        finalQuaternion.x *= -1;
        finalQuaternion.y *= -1;
        finalQuaternion.z *= -1;
        finalQuaternion.w *= -1;
      }
      previousFinalRotation.copy(finalQuaternion);

      quaternionValues.push(finalQuaternion.x, finalQuaternion.y, finalQuaternion.z, finalQuaternion.w);

      if (allowTranslation) {
        const deltaPosition = new THREE.Vector3(...keyframe.position).sub(basePosition);
        if (deltaPosition.length() > 6) {
          deltaPosition.setLength(6);
        }
        const finalPosition = (rest?.position ?? targetBone.position).clone().add(deltaPosition);
        positionValues.push(finalPosition.x, finalPosition.y, finalPosition.z);
      }
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(`${targetBone.name}.quaternion`, times, quaternionValues));

    if (allowTranslation) {
      tracks.push(new THREE.VectorKeyframeTrack(`${targetBone.name}.position`, times, positionValues));
    }
  }

  if (matchedBones < minimumMatches) {
    return {
      clip: null,
      matchedBones,
      error: `El esqueleto no coincide con esta IFP (${matchedBones}/${keyedBoneCount} bones).`
    };
  }

  if (tracks.length === 0) {
    return { clip: null, matchedBones, error: 'No se encontraron tracks compatibles para esta animacion.' };
  }

  return {
    clip: new THREE.AnimationClip(animation.name, -1, tracks),
    matchedBones
  };
}

function stopAnimation(viewer) {
  if (!viewer) {
    return;
  }

  viewer.animationAction?.stop();
  viewer.animationMixer?.stopAllAction();
  viewer.animationAction = null;
  viewer.animationClip = null;
  resetAnimationPose(viewer);
}

function applyIfpAnimation(viewer, animation, { playing, loop, speed }) {
  if (!viewer?.model) {
    return null;
  }

  stopAnimation(viewer);

  if (!animation) {
    viewer.animationState = null;
    return viewer.animationState;
  }

  if (!playing) {
    viewer.animationState = {
      name: animation.name,
      matchedBones: 0,
      error: ''
    };
    return viewer.animationState;
  }

  const result = createClipFromIfpAnimation(viewer, animation);
  if (!result?.clip) {
    viewer.animationState = {
      name: animation.name,
      matchedBones: result?.matchedBones ?? 0,
      error: result?.error ?? 'No se encontraron bones compatibles para esta animacion.'
    };
    return viewer.animationState;
  }

  viewer.animationMixer = new THREE.AnimationMixer(viewer.model);
  const action = viewer.animationMixer.clipAction(result.clip);
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = true;
  action.timeScale = speed;
  action.paused = !playing;
  action.play();

  viewer.animationAction = action;
  viewer.animationClip = result.clip;
  viewer.animationState = {
    name: animation.name,
    matchedBones: result.matchedBones,
    error: ''
  };
  return viewer.animationState;
}

export const DffViewportViewer = forwardRef(function DffViewportViewer(
  {
    selectedModel,
    wireframe,
    showBones,
    transformEnabled,
    transformMode,
    activeAnimation,
    animationPlaying,
    animationLoop,
    animationSpeed,
    onLoadStart,
    onLoadDone,
    onLoadError,
    onAnimationStatus
  },
  ref
) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const wireframeRef = useRef(wireframe);
  const showBonesRef = useRef(showBones);
  const transformEnabledRef = useRef(transformEnabled);
  const transformModeRef = useRef(transformMode);
  const activeAnimationRef = useRef(activeAnimation);
  const animationPlayingRef = useRef(animationPlaying);
  const animationLoopRef = useRef(animationLoop);
  const animationSpeedRef = useRef(animationSpeed);

  useImperativeHandle(ref, () => ({
    resetCamera() {
      const viewer = viewerRef.current;
      if (viewer?.modelRoot) {
        fitCameraToObject(viewer.camera, viewer.controls, viewer.modelRoot, viewer.renderer, viewer.grid);
      }
    },
    fitView() {
      const viewer = viewerRef.current;
      if (viewer?.modelRoot) {
        fitCameraToObject(viewer.camera, viewer.controls, viewer.modelRoot, viewer.renderer, viewer.grid);
      }
    },
    setMaterialVisible(materialId, visible) {
      const material = viewerRef.current?.materialById?.get(materialId);
      if (material) {
        material.visible = visible;
        material.needsUpdate = true;
      }
    },
    setAllMaterialsVisible(visible) {
      const viewer = viewerRef.current;
      if (!viewer?.materialById) {
        return;
      }

      for (const material of viewer.materialById.values()) {
        material.visible = visible;
        material.needsUpdate = true;
      }
    },
    setTransformEnabled(enabled) {
      const viewer = viewerRef.current;
      if (!viewer) {
        return;
      }

      viewer.transformEnabled = enabled;
      attachTransform(viewer);
    },
    setTransformMode(mode) {
      const viewer = viewerRef.current;
      if (!viewer?.transformControls) {
        return;
      }

      viewer.transformMode = mode;
      viewer.transformControls.setMode(mode);
    },
    resetModelTransform() {
      const viewer = viewerRef.current;
      if (!viewer?.modelRoot) {
        return;
      }

      resetModelRootTransform(viewer);
      fitCameraToObject(viewer.camera, viewer.controls, viewer.modelRoot, viewer.renderer, viewer.grid);
      attachTransform(viewer);
    },
    straightenModel() {
      straightenModel(viewerRef.current);
    },
    applyTextureOverride(materialId, dataUrl) {
      return applyMaterialTextureOverride(viewerRef.current, materialId, dataUrl);
    },
    clearTextureOverride(materialId) {
      return clearMaterialTextureOverride(viewerRef.current, materialId);
    },
    replaceTextureByName(textureName, dataUrl) {
      return applyTextureNameOverride(viewerRef.current, textureName, dataUrl);
    },
    revertTextureByName(textureName) {
      return clearTextureNameOverride(viewerRef.current, textureName);
    },
    clearAllTextureOverrides() {
      clearMaterialTextureOverrides(viewerRef.current);
      clearTextureNameOverrides(viewerRef.current);
    }
  }));

  useEffect(() => {
    const container = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101418);
    scene.fog = new THREE.Fog(0x101418, 18, 64);

    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.01, 500);
    camera.position.set(2.2, 1.7, 2.6);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.target.set(0, 0.9, 0);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode(transformModeRef.current ?? 'rotate');
    transformControls.setSpace('local');
    transformControls.visible = false;
    transformControls.enabled = false;
    transformControls.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value;
    });
    const transformHelper = transformControls.getHelper();
    transformHelper.visible = false;
    scene.add(transformHelper);

    const hemiLight = new THREE.HemisphereLight(0xc9f8ff, 0x2a312c, 2.1);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    const fillLight = new THREE.DirectionalLight(0x7fd5ff, 0.9);
    keyLight.position.set(3, 5, 4);
    fillLight.position.set(-4, 2, -3);
    scene.add(hemiLight, keyLight, fillLight);

    const grid = new THREE.GridHelper(10, 20, 0x2df5c6, 0x26313a);
    grid.material.opacity = 0.28;
    grid.material.transparent = true;
    scene.add(grid);

    const modelRoot = new THREE.Group();
    modelRoot.name = 'Model Root';
    scene.add(modelRoot);

    const clock = new THREE.Clock();
    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const viewer = viewerRef.current;
      if (viewer?.animationMixer && animationPlayingRef.current) {
        viewer.animationMixer.update(delta);
      }
      if (viewer?.boneHelpers?.length) {
        for (const helper of viewer.boneHelpers) {
          helper.update?.();
        }
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    viewerRef.current = {
      scene,
      camera,
      renderer,
      controls,
      transformControls,
      transformHelper,
      transformEnabled: Boolean(transformEnabledRef.current),
      transformMode: transformModeRef.current ?? 'rotate',
      grid,
      modelRoot,
      model: null,
      materialById: new Map(),
      boneHelpers: [],
      animationBones: [],
      boneById: new Map(),
      boneByName: new Map(),
      restBoneStates: new Map(),
      animationMixer: null,
      animationAction: null,
      animationClip: null,
      animationState: null,
      textureOverrideByMaterialId: new Map(),
      textureOverrideByTextureName: new Map()
    };

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      stopAnimation(viewerRef.current);
      removeBoneHelpers(viewerRef.current);
      clearMaterialTextureOverrides(viewerRef.current);
      clearTextureNameOverrides(viewerRef.current);
      viewerRef.current?.transformControls?.dispose();
      controls.dispose();

      if (viewerRef.current?.model) {
        viewerRef.current.modelRoot?.remove(viewerRef.current.model);
        disposeObject3D(viewerRef.current.model);
      }
      scene.remove(modelRoot);
      renderer.dispose();
      renderer.domElement.remove();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    wireframeRef.current = wireframe;

    const viewer = viewerRef.current;
    if (viewer?.model) {
      applyWireframe(viewer.model, wireframe);
    }
  }, [wireframe]);

  useEffect(() => {
    showBonesRef.current = showBones;
    updateBoneHelpers(viewerRef.current, Boolean(showBones));
  }, [showBones]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    transformEnabledRef.current = transformEnabled;
    viewer.transformEnabled = Boolean(transformEnabled);
    attachTransform(viewer);
  }, [transformEnabled]);

  useEffect(() => {
    const viewer = viewerRef.current;
    transformModeRef.current = transformMode;
    if (!viewer?.transformControls) {
      return;
    }

    viewer.transformMode = transformMode ?? 'rotate';
    viewer.transformControls.setMode(viewer.transformMode);
  }, [transformMode]);

  useEffect(() => {
    activeAnimationRef.current = activeAnimation;
    const viewer = viewerRef.current;
    if (!viewer?.model) {
      return;
    }

    const state = applyIfpAnimation(viewer, activeAnimation, {
      playing: animationPlayingRef.current,
      loop: animationLoopRef.current,
      speed: animationSpeedRef.current
    });
    onAnimationStatus?.(state);
  }, [activeAnimation, onAnimationStatus]);

  useEffect(() => {
    animationPlayingRef.current = animationPlaying;
    const viewer = viewerRef.current;
    if (!viewer?.model) {
      return;
    }

    if (animationPlaying) {
      const state = applyIfpAnimation(viewer, activeAnimationRef.current, {
        playing: true,
        loop: animationLoopRef.current,
        speed: animationSpeedRef.current
      });
      onAnimationStatus?.(state);
    } else {
      stopAnimation(viewer);
      onAnimationStatus?.({
        name: activeAnimationRef.current?.name ?? '',
        matchedBones: 0,
        error: ''
      });
    }
  }, [animationPlaying, onAnimationStatus]);

  useEffect(() => {
    animationLoopRef.current = animationLoop;
    const action = viewerRef.current?.animationAction;
    if (action) {
      action.setLoop(animationLoop ? THREE.LoopRepeat : THREE.LoopOnce, animationLoop ? Infinity : 1);
    }
  }, [animationLoop]);

  useEffect(() => {
    animationSpeedRef.current = animationSpeed;
    const action = viewerRef.current?.animationAction;
    if (action) {
      action.timeScale = animationSpeed;
    }
  }, [animationSpeed]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return undefined;
    }

    let canceled = false;

    async function loadModel() {
      if (viewer.model) {
        stopAnimation(viewer);
        removeBoneHelpers(viewer);
        clearMaterialTextureOverrides(viewer);
        clearTextureNameOverrides(viewer);
        viewer.transformControls?.detach();
        viewer.modelRoot?.remove(viewer.model);
        disposeObject3D(viewer.model);
        viewer.model = null;
        viewer.materialById = new Map();
        viewer.textureOverrideByMaterialId = new Map();
        viewer.textureOverrideByTextureName = new Map();
      }

      if (!selectedModel) {
        onLoadDone?.(null);
        return;
      }

      try {
        onLoadStart?.(selectedModel);

        if (!window.dffViewer?.readBinaryFile) {
          throw new Error('La lectura local solo esta disponible dentro de Electron.');
        }

        let textureDictionary = null;
        let txdWarning = null;

        if (selectedModel.txd) {
          try {
            const txdBuffer = await window.dffViewer.readBinaryFile(selectedModel.txd.fullPath);
            if (canceled) return;
            textureDictionary = normalizeTextureDictionary(new TXDLoader().parse(txdBuffer));
          } catch (error) {
            txdWarning = `No se pudo leer el TXD: ${error.message}`;
          }
        }

        const texturePreviews = createTexturePreviews(textureDictionary);
        const dffBuffer = await window.dffViewer.readBinaryFile(selectedModel.dff.fullPath);
        if (canceled) return;

        const loader = new DFFLoader();
        if (textureDictionary) {
          loader.setTextureDictionary(textureDictionary);
        }

        const model = loader.parse(dffBuffer);
        if (canceled) {
          disposeObject3D(model);
          disposeTextureDictionary(textureDictionary);
          return;
        }

        autoOrientObject(model);
        normalizeObject(model);
        tuneMaterials(model);
        clearSharpPreview(model);
        applyWireframe(model, wireframeRef.current);
        viewer.model = model;
        resetModelRootTransform(viewer);
        prepareAnimationBones(viewer);

        const materials = collectMaterialControls(model, texturePreviews);
        viewer.materialById = new Map();
        model.traverse((child) => {
          for (const material of materialArray(child.material)) {
            if (material.userData.viewerMaterialId) {
              viewer.materialById.set(material.userData.viewerMaterialId, material);
            }
          }
        });

        viewer.modelRoot.add(model);
        attachTransform(viewer);
        updateBoneHelpers(viewer, Boolean(showBonesRef.current));
        const animationState = applyIfpAnimation(viewer, activeAnimationRef.current, {
          playing: animationPlayingRef.current,
          loop: animationLoopRef.current,
          speed: animationSpeedRef.current
        });
        onAnimationStatus?.(animationState);
        fitCameraToObject(viewer.camera, viewer.controls, viewer.modelRoot, viewer.renderer, viewer.grid);

        const stats = collectModelStats(model, textureDictionary, selectedModel.dff, selectedModel.txd);
        disposeTextureDictionary(textureDictionary);
        onLoadDone?.({ stats, warning: txdWarning, materials, textures: texturePreviews });
      } catch (error) {
        onLoadError?.(error);
      }
    }

    loadModel();

    return () => {
      canceled = true;
    };
  }, [selectedModel, onLoadStart, onLoadDone, onLoadError, onAnimationStatus]);

  return <div className="viewport-canvas" ref={mountRef} />;
});
