import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  CircleHelp,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  ImagePlus,
  Info,
  Maximize2,
  MousePointer2,
  Move3d,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Rotate3d,
  Save,
  Scale3d,
  Search,
  Star,
  Undo2,
  X
} from 'lucide-react';
import { DffViewportViewer } from './components/DffViewportViewer.jsx';
import { buildCatalog, filterModels } from './lib/fileCatalog.js';
import { compactPath, formatBytes } from './lib/format.js';
import { getIfpSummary, parseIfp } from './lib/ifp.js';
import { composeLogoTexture } from './lib/textureComposer.js';

const api = window.dffViewer;
const defaultAccentColor = '#2df5c6';
const favoritesStorageKey = 'skinViewerFavorites';
const defaultLogoOverlay = {
  imageDataUrl: '',
  name: '',
  aspect: 1,
  targetMaterialId: '',
  opacity: 0.85,
  size: 0.28,
  x: 0.5,
  y: 0.5,
  rotation: 0,
  editedTextureDataUrl: '',
  savedPath: '',
  txdSavedPath: '',
  txdBackupPath: ''
};

function readStoredFavorites() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(favoritesStorageKey) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function persistStoredFavorites(favorites) {
  window.localStorage.setItem(favoritesStorageKey, JSON.stringify(favorites));
}

function textureNameKey(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\s+\(\d+\)$/g, '')
    .trim();
}

function materialUsesTexture(material, textureName) {
  const key = textureNameKey(textureName);
  if (!key) {
    return false;
  }

  return [material.textureName, material.baseName, material.displayName].some((value) => textureNameKey(value) === key);
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('Selecciona una imagen PNG, JPG o compatible.'));
      return;
    }

    const reader = new window.FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => reject(new Error('La imagen no se pudo decodificar.'));
      image.onload = () => {
        resolve({
          name: file.name,
          dataUrl: reader.result,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function hexToRgb(hexColor) {
  const normalized = hexColor.replace('#', '');
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized, 16);

  if (Number.isNaN(value)) {
    return '45, 245, 198';
  }

  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

function IconButton({ icon: Icon, label, title, active, disabled, onClick }) {
  return (
    <button
      className={`icon-button${active ? ' is-active' : ''}`}
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} strokeWidth={2.1} />
    </button>
  );
}

function ToastStack({ notifications, onDismiss }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {notifications.map((notification) => (
        <ToastItem key={notification.id} notification={notification} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ notification, onDismiss }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(notification.id), 5000);
    return () => window.clearTimeout(timer);
  }, [notification.id, onDismiss]);

  const Icon = notification.type === 'success'
    ? CheckCircle
    : notification.type === 'info'
      ? Info
      : AlertTriangle;

  return (
    <article className={`app-toast is-${notification.type}`} role={notification.type === 'error' ? 'alert' : 'status'}>
      <Icon size={17} />
      <div>
        <strong>{notification.title}</strong>
        {notification.message && <span>{notification.message}</span>}
      </div>
      <button className="toast-close" type="button" aria-label="Cerrar notificacion" onClick={() => onDismiss(notification.id)}>
        <X size={14} />
      </button>
    </article>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CollapsibleSection({ title, className = '', count, actions, defaultCollapsed = false, children }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className={`inspector-section collapsible-section ${className}${collapsed ? ' is-collapsed' : ''}`}>
      <div className="section-heading-row">
        <button className="section-collapse-button" type="button" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h3>{title}</h3>
          {count !== undefined && <span className="section-count">{count}</span>}
        </button>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      {!collapsed && children}
    </section>
  );
}

function MaterialControls({ materials, onToggleMaterial, onShowAll }) {
  const hiddenCount = materials.filter((material) => !material.visible).length;

  return (
    <CollapsibleSection
      title="Materiales"
      className="material-section"
      count={materials.length}
      actions={hiddenCount > 0 && (
          <button className="tiny-button" type="button" onClick={onShowAll}>
            Mostrar todo
          </button>
      )}
    >

      <div className="material-list">
        {materials.map((material) => (
          <div key={material.id} className={`material-item${material.visible ? '' : ' is-hidden'}`}>
            <div className="material-thumb" style={{ backgroundColor: material.color }}>
              {material.previewDataUrl && <img src={material.previewDataUrl} alt="" draggable="false" />}
            </div>
            <div className="material-meta">
              <strong>{material.displayName}</strong>
              <small>{material.textureName || `Slot ${material.slotIndex + 1}`}</small>
            </div>
            <button
              className="material-toggle"
              type="button"
              title={material.visible ? 'Ocultar material' : 'Mostrar material'}
              aria-label={material.visible ? `Ocultar ${material.displayName}` : `Mostrar ${material.displayName}`}
              aria-pressed={!material.visible}
              onClick={() => onToggleMaterial(material.id)}
            >
              {material.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
          </div>
        ))}

        {materials.length === 0 && <div className="empty-inspector">Sin materiales detectados.</div>}
      </div>
    </CollapsibleSection>
  );
}

function TextureGrid({
  textures,
  editStatus,
  canSave,
  saving,
  onReplaceTexture,
  onRevertTexture,
  onSaveTextures
}) {
  const fileInputRef = useRef(null);
  const pendingTextureRef = useRef(null);
  const editedCount = textures.filter((texture) => texture.replaced).length;

  const openTexturePicker = (texture) => {
    pendingTextureRef.current = texture;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    const texture = pendingTextureRef.current;
    pendingTextureRef.current = null;

    if (texture && file) {
      onReplaceTexture(texture, file);
    }
  };

  return (
    <CollapsibleSection
      title="Texturas"
      className="texture-section"
      count={textures.length}
      actions={textures.length > 0 && (
        <button
          className="tiny-button"
          type="button"
          disabled={!canSave || saving}
          title={canSave ? `Guardar ${editedCount} textura${editedCount === 1 ? '' : 's'} en el TXD` : 'Cambia una textura para guardar el TXD'}
          onClick={onSaveTextures}
        >
          <Save size={12} />
          <span>{saving ? 'Guardando' : 'Guardar TXD'}</span>
        </button>
      )}
    >
      <input ref={fileInputRef} className="hidden-input" type="file" accept="image/*" onChange={handleFileChange} />

      <div className="texture-grid">
        {textures.map((texture) => (
          <div key={texture.id} className={`texture-card${texture.replaced ? ' is-edited' : ''}`}>
            <button
              className="texture-pick-button"
              type="button"
              title={`Cambiar ${texture.name}`}
              disabled={editStatus.name === texture.name}
              onClick={() => openTexturePicker(texture)}
            >
              <div className="texture-thumb">
                <img src={texture.dataUrl} alt="" draggable="false" />
                <span>{texture.width}x{texture.height}</span>
                <em>
                  <ImagePlus size={13} />
                  {editStatus.name === texture.name ? 'Aplicando' : 'Cambiar'}
                </em>
              </div>
              <strong>{texture.name}</strong>
            </button>
            {texture.replaced && (
              <button className="texture-revert-button" type="button" onClick={() => onRevertTexture(texture)}>
                <Undo2 size={12} />
                <span>Revertir</span>
              </button>
            )}
          </div>
        ))}

        {textures.length === 0 && <div className="empty-inspector">Sin texturas cargadas.</div>}
      </div>

      {editStatus.error && (
        <div className="warning-line is-error">
          <AlertTriangle size={16} />
          <span>{editStatus.error}</span>
        </div>
      )}
    </CollapsibleSection>
  );
}

function GizmoControls({
  transformEnabled,
  transformMode,
  showBones,
  onToggleTransform,
  onModeChange,
  onToggleBones,
  onStraighten,
  onResetTransform
}) {
  return (
    <CollapsibleSection
      title="Gizmo y bones"
      className="tool-section"
      actions={
        <button className={`tiny-button${showBones ? ' is-active' : ''}`} type="button" onClick={onToggleBones}>
          Bones
        </button>
      }
    >

      <div className="tool-button-grid is-two">
        <button className={`tool-button${transformEnabled ? ' is-active' : ''}`} type="button" onClick={onToggleTransform}>
          <MousePointer2 size={14} />
          Gizmo
        </button>
        {[
          { mode: 'translate', label: 'Mover', Icon: Move3d },
          { mode: 'rotate', label: 'Rotar', Icon: Rotate3d },
          { mode: 'scale', label: 'Escalar', Icon: Scale3d }
        ].map(({ mode, label, Icon }) => (
          <button
            key={mode}
            className={`tool-button${transformMode === mode && transformEnabled ? ' is-active' : ''}`}
            type="button"
            onClick={() => onModeChange(mode)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="tool-button-grid is-two">
        <button className="tool-button" type="button" onClick={onStraighten}>
          Enderezar
        </button>
        <button className="tool-button" type="button" onClick={onResetTransform}>
          Reset transform
        </button>
      </div>
    </CollapsibleSection>
  );
}

function LogoEditor({
  logoOverlay,
  materials,
  targetMaterial,
  composeError,
  saving,
  onLoadLogo,
  onLogoChange,
  onApplyLogo,
  onSaveLogo,
  onClearLogo
}) {
  const fileInputRef = useRef(null);

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const loadFile = (file) => {
    if (!file) {
      return;
    }

    const reader = new window.FileReader();
    reader.onload = () => {
      const image = new window.Image();
      image.onload = () => {
        onLoadLogo({
          name: file.name,
          imageDataUrl: reader.result,
          aspect: image.width && image.height ? image.width / image.height : 1
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const nudgeLogo = (changes) => {
    const nextChanges = { savedPath: '' };
    if (changes.x !== undefined) {
      nextChanges.x = clampValue(changes.x, 0, 1);
    }
    if (changes.y !== undefined) {
      nextChanges.y = clampValue(changes.y, 0, 1);
    }
    if (changes.size !== undefined) {
      nextChanges.size = clampValue(changes.size, 0.03, 1);
    }
    onLogoChange(nextChanges);
  };

  return (
    <CollapsibleSection
      title="Logo en material"
      className="logo-section"
      actions={logoOverlay.imageDataUrl && (
          <button className="tiny-button" type="button" onClick={onClearLogo}>
            Quitar
          </button>
      )}
    >
      <div className="logo-step">
        <span className="logo-step-index">1</span>
        <div className="logo-step-body">
          <strong>Elegir material</strong>
          <label className="select-control">
            <span>Material destino</span>
            <select
              value={logoOverlay.targetMaterialId}
              disabled={materials.length === 0}
              onChange={(event) => onLogoChange({ targetMaterialId: event.target.value, editedTextureDataUrl: '', savedPath: '' })}
            >
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.displayName}
                </option>
              ))}
            </select>
          </label>
          {targetMaterial?.previewDataUrl && (
            <div className="logo-material-preview">
              <img src={targetMaterial.previewDataUrl} alt="" draggable="false" />
              <span>{targetMaterial.displayName}</span>
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        onChange={(event) => loadFile(event.target.files?.[0])}
      />

      <div className="logo-step">
        <span className="logo-step-index">2</span>
        <div className="logo-step-body">
          <strong>Cargar imagen</strong>
          <button className="primary-tool-button" type="button" disabled={!targetMaterial} onClick={openFilePicker}>
            <ImagePlus size={15} />
            <span>{logoOverlay.imageDataUrl ? 'Cambiar imagen' : 'Cargar imagen'}</span>
          </button>

          {logoOverlay.imageDataUrl ? (
            <div className="logo-preview-row">
              <div className="logo-preview">
                <img src={logoOverlay.imageDataUrl} alt="" draggable="false" />
              </div>
              <div>
                <strong>{logoOverlay.name}</strong>
                <span>{targetMaterial ? `Pegado a ${targetMaterial.displayName}` : 'Elige un material con textura.'}</span>
              </div>
            </div>
          ) : (
            <p className="tool-note">Usa PNG/JPG con fondo transparente si queres que se funda mejor con la textura.</p>
          )}
        </div>
      </div>

      {logoOverlay.imageDataUrl ? (
        <div className="logo-step is-editor">
          <span className="logo-step-index">3</span>
          <div className="logo-step-body">
            <strong>Ajustar y guardar</strong>
            <div className="texture-compose-preview">
              {logoOverlay.editedTextureDataUrl ? (
                <img src={logoOverlay.editedTextureDataUrl} alt="" draggable="false" />
              ) : (
                <span>Previsualizando textura...</span>
              )}
            </div>

            <div className="logo-gizmo-panel" aria-label="Ajuste de logo">
              <div>
                <span className="logo-control-label">Mover</span>
                <div className="logo-gizmo-pad">
                  <button className="icon-button" type="button" title="Subir" onClick={() => nudgeLogo({ y: logoOverlay.y - 0.02 })}>
                    <ArrowUp size={15} />
                  </button>
                  <button className="icon-button" type="button" title="Izquierda" onClick={() => nudgeLogo({ x: logoOverlay.x - 0.02 })}>
                    <ArrowLeft size={15} />
                  </button>
                  <button className="icon-button" type="button" title="Derecha" onClick={() => nudgeLogo({ x: logoOverlay.x + 0.02 })}>
                    <ArrowRight size={15} />
                  </button>
                  <button className="icon-button" type="button" title="Bajar" onClick={() => nudgeLogo({ y: logoOverlay.y + 0.02 })}>
                    <ArrowDown size={15} />
                  </button>
                </div>
              </div>
              <div>
                <span className="logo-control-label">Escala y rotacion</span>
                <div className="logo-gizmo-actions">
                  <button className="icon-button" type="button" title="Reducir" onClick={() => nudgeLogo({ size: logoOverlay.size - 0.03 })}>
                    <Minus size={15} />
                  </button>
                  <button className="icon-button" type="button" title="Agrandar" onClick={() => nudgeLogo({ size: logoOverlay.size + 0.03 })}>
                    <Plus size={15} />
                  </button>
                  <button className="icon-button" type="button" title="Rotar izquierda" onClick={() => onLogoChange({ rotation: logoOverlay.rotation - 5, savedPath: '' })}>
                    <RotateCcw size={15} />
                  </button>
                  <button className="icon-button" type="button" title="Rotar derecha" onClick={() => onLogoChange({ rotation: logoOverlay.rotation + 5, savedPath: '' })}>
                    <RotateCw size={15} />
                  </button>
                </div>
              </div>
            </div>

            <div className="tool-button-grid is-two logo-action-row">
              <button
                className="tool-button"
                type="button"
                disabled={!logoOverlay.editedTextureDataUrl || !targetMaterial}
                onClick={onApplyLogo}
              >
                Aplicar
              </button>
              <button
                className="tool-button"
                type="button"
                disabled={!logoOverlay.editedTextureDataUrl || saving}
                onClick={onSaveLogo}
              >
                {saving ? 'Guardando' : 'Guardar'}
              </button>
            </div>

            <div className="logo-sliders">
              <label className="range-control">
                <span>Opacidad</span>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={logoOverlay.opacity}
                  onChange={(event) => onLogoChange({ opacity: Number(event.target.value), savedPath: '' })}
                />
              </label>
              <label className="range-control">
                <span>Tamano</span>
                <input
                  type="range"
                  min="0.03"
                  max="1"
                  step="0.01"
                  value={logoOverlay.size}
                  onChange={(event) => onLogoChange({ size: Number(event.target.value), savedPath: '' })}
                />
              </label>
              <label className="range-control">
                <span>X textura</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={logoOverlay.x}
                  onChange={(event) => onLogoChange({ x: Number(event.target.value), savedPath: '' })}
                />
              </label>
              <label className="range-control">
                <span>Y textura</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={logoOverlay.y}
                  onChange={(event) => onLogoChange({ y: Number(event.target.value), savedPath: '' })}
                />
              </label>
              <label className="range-control">
                <span>Rotacion</span>
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={logoOverlay.rotation}
                  onChange={(event) => onLogoChange({ rotation: Number(event.target.value), savedPath: '' })}
                />
              </label>
            </div>

            {logoOverlay.savedPath && (
              <p className="tool-note">Guardado: {compactPath(logoOverlay.savedPath)}</p>
            )}
            {logoOverlay.txdSavedPath && (
              <p className="tool-note">TXD: {compactPath(logoOverlay.txdSavedPath)}</p>
            )}
            {logoOverlay.txdBackupPath && (
              <p className="tool-note">Backup: {compactPath(logoOverlay.txdBackupPath)}</p>
            )}
            {composeError && (
              <div className="warning-line is-error">
                <AlertTriangle size={16} />
                <span>{composeError}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        null
      )}
    </CollapsibleSection>
  );
}

function AppearanceSettings({ pendingAccentColor, saved, onPendingChange, onSave }) {
  return (
    <CollapsibleSection
      title="Apariencia"
      className="appearance-section"
      actions={<span className={`save-state${saved ? ' is-saved' : ''}`}>{saved ? 'Guardado' : 'Sin guardar'}</span>}
    >
      <div className="color-setting-row">
        <input type="color" value={pendingAccentColor} onChange={(event) => onPendingChange(event.target.value)} />
        <code>{pendingAccentColor}</code>
        <button className="tiny-button" type="button" onClick={onSave}>
          Guardar
        </button>
      </div>
    </CollapsibleSection>
  );
}

function AnimationPanel({
  ifpFiles,
  selectedIfpPath,
  ifpSummary,
  selectedAnimationName,
  playing,
  loop,
  speed,
  error,
  onSelectIfp,
  onSelectAnimation,
  onTogglePlaying,
  onToggleLoop,
  onSpeedChange
}) {
  return (
    <CollapsibleSection title="Animaciones IFP" className="animation-section" count={ifpFiles.length}>
      {ifpFiles.length > 0 ? (
        <>
          <label className="select-control">
            <span>Archivo</span>
            <select value={selectedIfpPath} onChange={(event) => onSelectIfp(event.target.value)}>
              <option value="">Sin IFP</option>
              {ifpFiles.map((file) => (
                <option key={file.fullPath} value={file.fullPath}>
                  {file.name}
                </option>
              ))}
            </select>
          </label>

          <label className="select-control">
            <span>Animacion</span>
            <select
              value={selectedAnimationName}
              disabled={!ifpSummary?.animations?.length}
              onChange={(event) => onSelectAnimation(event.target.value)}
            >
              <option value="">Sin animacion</option>
              {(ifpSummary?.animations ?? []).map((animation) => (
                <option key={animation.name} value={animation.name}>
                  {animation.name}
                </option>
              ))}
            </select>
          </label>

          <div className="tool-button-grid is-three">
            <button className={`tool-button${playing ? ' is-active' : ''}`} type="button" onClick={onTogglePlaying} disabled={!selectedAnimationName}>
              {playing ? 'Pausa' : 'Play'}
            </button>
            <button className={`tool-button${loop ? ' is-active' : ''}`} type="button" onClick={onToggleLoop} disabled={!selectedAnimationName}>
              Loop
            </button>
            <button className="tool-button" type="button" onClick={() => onSpeedChange(1)}>
              1x
            </button>
          </div>

          <label className="range-control">
            <span>Velocidad</span>
            <input
              type="range"
              min="0.1"
              max="2.5"
              step="0.1"
              value={speed}
              onChange={(event) => onSpeedChange(Number(event.target.value))}
            />
          </label>

          {ifpSummary && (
            <div className="ifp-summary">
              <span>{ifpSummary.version}</span>
              <span>{ifpSummary.animationCount} anim.</span>
              {selectedAnimationName && (
                <span>
                  {(ifpSummary.animations.find((animation) => animation.name === selectedAnimationName)?.duration ?? 0).toFixed(2)}s
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="tool-note">No hay archivos .ifp en la carpeta seleccionada.</p>
      )}

      {error && (
        <div className="warning-line is-error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
    </CollapsibleSection>
  );
}

function FileSidebar({
  folderPath,
  catalog,
  models,
  favoriteModels,
  favoriteByPath,
  selectedId,
  query,
  busy,
  onQueryChange,
  onOpenFolder,
  onToggleFavorite,
  onSelect
}) {
  const [folderCollapsed, setFolderCollapsed] = useState(false);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);

  const handleRowKeyDown = (event, modelId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(modelId);
    }
  };

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark">
          <Box size={18} />
        </div>
        <div>
          <h1>Skin Viewer</h1>
          <p>RenderWare DFF / TXD</p>
        </div>
      </div>

      <button className="primary-button" type="button" onClick={onOpenFolder} disabled={busy}>
        <FolderOpen size={17} />
        <span>Abrir carpeta</span>
      </button>

      <section className={`sidebar-foldout${folderCollapsed ? ' is-collapsed' : ''}`}>
        <button className="foldout-heading" type="button" onClick={() => setFolderCollapsed((collapsed) => !collapsed)}>
          <span>
            <Folder size={14} />
            Carpeta actual
          </span>
          {folderCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        {!folderCollapsed && (
          <div className="folder-chip" title={folderPath || 'Sin carpeta'}>
            {folderPath || 'Sin carpeta'}
          </div>
        )}
      </section>

      <div className="catalog-stats" aria-label="Resumen de archivos">
        <span>{catalog.dffCount} DFF</span>
        <span>{catalog.txdCount} TXD</span>
        <span>{catalog.ifpCount} IFP</span>
      </div>

      <label className="search-field">
        <Search size={16} />
        <input
          type="search"
          placeholder="Filtrar modelos"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <section className={`favorites-panel${favoritesCollapsed ? ' is-collapsed' : ''}`} aria-label="Skins favoritas">
        <button className="favorites-heading" type="button" onClick={() => setFavoritesCollapsed((collapsed) => !collapsed)}>
          <span>
            <Star size={14} />
            Favoritas
          </span>
          <span className="foldout-end">
            <strong>{favoriteModels.length}</strong>
            {favoritesCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          </span>
        </button>
        {!favoritesCollapsed && favoriteModels.length > 0 ? (
          <div className="favorite-list">
            {favoriteModels.map((model) => (
              <button key={model.id} className="favorite-chip" type="button" onClick={() => onSelect(model.id)}>
                <Star size={12} fill="currentColor" />
                <span>{model.displayName}</span>
              </button>
            ))}
          </div>
        ) : !favoritesCollapsed ? (
          <p>Marca una skin con la estrella para copiarla a favorites.</p>
        ) : null}
      </section>

      <div className="model-list" role="listbox" aria-label="Modelos DFF">
        {models.map((model) => (
          <div
            key={model.id}
            className={`model-row${selectedId === model.id ? ' is-selected' : ''}`}
            role="option"
            tabIndex={0}
            aria-selected={selectedId === model.id}
            onClick={() => onSelect(model.id)}
            onKeyDown={(event) => handleRowKeyDown(event, model.id)}
          >
            <span className="model-row-icon">
              <Box size={16} />
            </span>
            <span className="model-row-main">
              <strong>{model.displayName}</strong>
              <small>{model.dff.relativePath}</small>
            </span>
            <button
              className={`favorite-toggle${favoriteByPath[model.dff.fullPath] ? ' is-active' : ''}`}
              type="button"
              title={favoriteByPath[model.dff.fullPath] ? 'Quitar de favoritas' : 'Copiar a favorites'}
              aria-label={favoriteByPath[model.dff.fullPath] ? `Quitar ${model.displayName} de favoritas` : `Marcar ${model.displayName} como favorita`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleFavorite(model);
              }}
            >
              <Star size={14} fill={favoriteByPath[model.dff.fullPath] ? 'currentColor' : 'none'} />
            </button>
            <span className={`pair-dot${model.hasTexture ? ' is-ok' : ' is-missing'}`} title={model.hasTexture ? 'TXD encontrado' : 'TXD faltante'} />
          </div>
        ))}

        {models.length === 0 && (
          <div className="empty-list">
            {folderPath ? 'No hay modelos para mostrar.' : 'Selecciona una carpeta.'}
          </div>
        )}
      </div>
    </aside>
  );
}

function Inspector({
  selectedModel,
  stats,
  warning,
  loadState,
  materials,
  textures,
  textureEditStatus,
  ifpFiles,
  selectedIfpPath,
  ifpSummary,
  selectedAnimationName,
  animationPlaying,
  animationLoop,
  animationSpeed,
  animationError,
  transformEnabled,
  transformMode,
  showBones,
  logoOverlay,
  logoComposeError,
  logoSaving,
  pendingAccentColor,
  colorSaved,
  onToggleMaterial,
  onShowAllMaterials,
  onReplaceTexture,
  onRevertTexture,
  onSaveTextures,
  canSaveTextures,
  textureSaving,
  onSelectIfp,
  onSelectAnimation,
  onToggleAnimationPlaying,
  onToggleAnimationLoop,
  onAnimationSpeedChange,
  onToggleTransform,
  onTransformModeChange,
  onToggleBones,
  onStraighten,
  onResetTransform,
  onLoadLogo,
  onLogoChange,
  onApplyLogo,
  onSaveLogo,
  onClearLogo,
  onPendingAccentChange,
  onSaveAccent
}) {
  return (
    <aside className="inspector">
      <div className="panel-title">
        <Info size={17} />
        <h2>Inspector</h2>
      </div>

      {selectedModel && (
        <div className="file-block">
          <strong>{selectedModel.displayName}</strong>
          <div className="file-size-stack" aria-label="Peso de archivos">
            <span>DFF {formatBytes(selectedModel.dff.size)}</span>
            {selectedModel.txd ? (
              <span>TXD {formatBytes(selectedModel.txd.size)}</span>
            ) : (
              <span className="is-missing">sin TXD</span>
            )}
          </div>
        </div>
      )}

      {warning && (
        <div className="warning-line">
          <AlertTriangle size={16} />
          <span>{warning}</span>
        </div>
      )}

      {loadState.status === 'error' && (
        <div className="warning-line is-error">
          <AlertTriangle size={16} />
          <span>{loadState.message}</span>
        </div>
      )}

      {stats ? (
        <>
          <CollapsibleSection title="Geometria">
            <StatRow label="Mallas" value={stats.meshCount} />
            <StatRow label="Skinned" value={stats.skinnedMeshCount} />
            <StatRow label="Vertices" value={stats.vertexCount.toLocaleString('es-AR')} />
            <StatRow label="Triangulos" value={stats.triangleCount.toLocaleString('es-AR')} />
            <StatRow label="Materiales" value={stats.materialCount} />
            <StatRow label="Bounds" value={`${stats.bounds.x} x ${stats.bounds.y} x ${stats.bounds.z}`} />
          </CollapsibleSection>

          <GizmoControls
            transformEnabled={transformEnabled}
            transformMode={transformMode}
            showBones={showBones}
            onToggleTransform={onToggleTransform}
            onModeChange={onTransformModeChange}
            onToggleBones={onToggleBones}
            onStraighten={onStraighten}
            onResetTransform={onResetTransform}
          />
          <AnimationPanel
            ifpFiles={ifpFiles}
            selectedIfpPath={selectedIfpPath}
            ifpSummary={ifpSummary}
            selectedAnimationName={selectedAnimationName}
            playing={animationPlaying}
            loop={animationLoop}
            speed={animationSpeed}
            error={animationError}
            onSelectIfp={onSelectIfp}
            onSelectAnimation={onSelectAnimation}
            onTogglePlaying={onToggleAnimationPlaying}
            onToggleLoop={onToggleAnimationLoop}
            onSpeedChange={onAnimationSpeedChange}
          />
          <LogoEditor
            logoOverlay={logoOverlay}
            materials={materials}
            targetMaterial={materials.find((material) => material.id === logoOverlay.targetMaterialId) ?? null}
            composeError={logoComposeError}
            saving={logoSaving}
            onLoadLogo={onLoadLogo}
            onLogoChange={onLogoChange}
            onApplyLogo={onApplyLogo}
            onSaveLogo={onSaveLogo}
            onClearLogo={onClearLogo}
          />
          <AppearanceSettings
            pendingAccentColor={pendingAccentColor}
            saved={colorSaved}
            onPendingChange={onPendingAccentChange}
            onSave={onSaveAccent}
          />
          <MaterialControls materials={materials} onToggleMaterial={onToggleMaterial} onShowAll={onShowAllMaterials} />
          <TextureGrid
            textures={textures}
            editStatus={textureEditStatus}
            canSave={canSaveTextures}
            saving={textureSaving}
            onReplaceTexture={onReplaceTexture}
            onRevertTexture={onRevertTexture}
            onSaveTextures={onSaveTextures}
          />
        </>
      ) : (
        <div className="empty-inspector">Sin modelo cargado.</div>
      )}
    </aside>
  );
}

function TopToolbar({
  selectedModel,
  folderPath,
  busy,
  wireframe,
  onOpenFolder,
  onRescan,
  onResetCamera,
  onFitView,
  onToggleWireframe,
  onOpenHelp
}) {
  return (
    <header className="topbar">
      <div className="toolbar-group">
        <button className="toolbar-button" type="button" onClick={onOpenFolder} disabled={busy}>
          <FolderOpen size={16} />
          <span>Abrir</span>
        </button>
        <IconButton icon={RefreshCw} label="Actualizar carpeta" disabled={!folderPath || busy} onClick={onRescan} />
      </div>

      <div className="toolbar-group">
        <IconButton icon={RotateCcw} label="Resetear camara" disabled={!selectedModel} onClick={onResetCamera} />
        <IconButton icon={Maximize2} label="Encuadrar modelo" disabled={!selectedModel} onClick={onFitView} />
        <IconButton icon={Eye} label="Wireframe" active={wireframe} disabled={!selectedModel} onClick={onToggleWireframe} />
        <IconButton icon={CircleHelp} label="Ayuda" onClick={onOpenHelp} />
      </div>

      <div className="toolbar-status">
        {selectedModel ? (
          <>
            <span className="status-dot" />
            <strong>{selectedModel.displayName}</strong>
            <span>{selectedModel.txd ? selectedModel.txd.name : 'sin TXD'}</span>
          </>
        ) : (
          <span>Sin seleccion</span>
        )}
      </div>
    </header>
  );
}

function HelpDialog({ open, onClose }) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div className="help-dialog-header">
          <div>
            <h2 id="help-title">Ayuda rapida</h2>
            <p>Skin Viewer by Tokyo tears</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar ayuda" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="help-dialog-body">
          <section>
            <h3>Importar</h3>
            <p>Usa Abrir para seleccionar una carpeta con archivos .dff y .txd. El visor empareja cada DFF con un TXD del mismo nombre dentro de la carpeta.</p>
          </section>
          <section>
            <h3>Camara</h3>
            <p>Click izquierdo y arrastrar rota la camara, rueda acerca o aleja, click derecho desplaza. Reset vuelve a encuadrar el modelo.</p>
          </section>
          <section>
            <h3>Materiales y texturas</h3>
            <p>El ojo oculta materiales. En Texturas, toca una miniatura para reemplazarla con una imagen; Revertir devuelve la textura original cargada del TXD.</p>
          </section>
          <section>
            <h3>Favoritas</h3>
            <p>La estrella copia el DFF y su TXD a una carpeta favorites junto al ejecutable.</p>
          </section>
          <section>
            <h3>Gizmo, bones e IFP</h3>
            <p>Activa Gizmo para mover, rotar o escalar el modelo. Bones muestra el esqueleto si existe. Los IFP de la carpeta se cargan desde el inspector.</p>
          </section>
          <section>
            <h3>Seguridad</h3>
            <p>Antes de editar texturas o guardar cambios, haz una copia de tus skins originales para poder volver atras si un archivo queda mal.</p>
          </section>
        </div>
      </section>
    </div>
  );
}

function ViewportOverlay({ selectedModel, loadState }) {
  if (loadState.status === 'error') {
    return (
      <div className="viewport-empty">
        <AlertTriangle size={42} />
        <strong>No se pudo abrir la carpeta</strong>
        <span>{loadState.message}</span>
      </div>
    );
  }

  if (loadState.status === 'loading') {
    return (
      <div className="viewport-loading">
        <span className="spinner" />
        <strong>{loadState.message}</strong>
      </div>
    );
  }

  if (!selectedModel) {
    return (
      <div className="viewport-empty">
        <Box size={42} />
        <strong>No hay DFF seleccionado</strong>
        <span>Abre una carpeta para empezar.</span>
      </div>
    );
  }

  return null;
}

export default function App() {
  const viewportRef = useRef(null);
  const liveLogoMaterialRef = useRef('');
  const [folderPath, setFolderPath] = useState('');
  const [files, setFiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showBones, setShowBones] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [transformEnabled, setTransformEnabled] = useState(false);
  const [transformMode, setTransformMode] = useState('rotate');
  const [logoOverlay, setLogoOverlay] = useState(defaultLogoOverlay);
  const [accentColor, setAccentColor] = useState(() => window.localStorage.getItem('skinViewerAccentColor') || defaultAccentColor);
  const [pendingAccentColor, setPendingAccentColor] = useState(accentColor);
  const [colorSaved, setColorSaved] = useState(true);
  const [favoriteByPath, setFavoriteByPath] = useState(readStoredFavorites);
  const [stats, setStats] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [textures, setTextures] = useState([]);
  const [textureEditStatus, setTextureEditStatus] = useState({ name: '', error: '' });
  const [textureSaving, setTextureSaving] = useState(false);
  const [ifpData, setIfpData] = useState(null);
  const [ifpSummary, setIfpSummary] = useState(null);
  const [selectedIfpPath, setSelectedIfpPath] = useState('');
  const [selectedAnimationName, setSelectedAnimationName] = useState('');
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [animationLoop, setAnimationLoop] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [animationError, setAnimationError] = useState('');
  const [logoComposeError, setLogoComposeError] = useState('');
  const [logoSaving, setLogoSaving] = useState(false);
  const [warning, setWarning] = useState('');
  const [loadState, setLoadState] = useState({ status: 'idle', message: '' });
  const [notifications, setNotifications] = useState([]);

  const catalog = useMemo(() => buildCatalog(files), [files]);
  const filteredModels = useMemo(() => filterModels(catalog.models, query), [catalog.models, query]);
  const selectedModel = useMemo(
    () => catalog.models.find((model) => model.id === selectedId) ?? null,
    [catalog.models, selectedId]
  );
  const favoriteModels = useMemo(
    () => catalog.models.filter((model) => Boolean(favoriteByPath[model.dff.fullPath])),
    [catalog.models, favoriteByPath]
  );
  const canSaveTextures = useMemo(
    () => Boolean(selectedModel?.txd && textures.some((texture) => texture.replaced)),
    [selectedModel?.txd, textures]
  );
  const activeAnimation = useMemo(() => {
    if (!ifpData || !selectedAnimationName) {
      return null;
    }

    return ifpData.data.animations.find((animation) => animation.name === selectedAnimationName) ?? null;
  }, [ifpData, selectedAnimationName]);
  const logoTargetMaterial = useMemo(
    () => materials.find((material) => material.id === logoOverlay.targetMaterialId) ?? null,
    [materials, logoOverlay.targetMaterialId]
  );

  const updateFavorites = useCallback((updater) => {
    setFavoriteByPath((currentFavorites) => {
      const nextFavorites = typeof updater === 'function' ? updater(currentFavorites) : updater;
      persistStoredFavorites(nextFavorites);
      return nextFavorites;
    });
  }, []);

  const pushNotification = useCallback(({ type = 'info', title, message = '' }) => {
    const notification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      title,
      message
    };

    setNotifications((currentNotifications) => [notification, ...currentNotifications].slice(0, 5));
  }, []);

  const dismissNotification = useCallback((id) => {
    setNotifications((currentNotifications) => currentNotifications.filter((notification) => notification.id !== id));
  }, []);

  useEffect(() => {
    if (!api?.onUpdateStatus) {
      return undefined;
    }

    return api.onUpdateStatus((status) => {
      if (!status || status.type === 'idle' || status.type === 'checking') {
        return;
      }

      pushNotification({
        type: status.type === 'error' ? 'error' : status.type === 'downloaded' ? 'success' : 'info',
        title: status.title || 'Actualizacion',
        message: status.message || ''
      });
    });
  }, [pushNotification]);

  const writeTexturesToTxd = useCallback(async (nextTextures) => {
    if (!selectedModel?.txd?.fullPath || !api?.saveTxdTextures) {
      throw new Error('No hay un TXD asociado para guardar.');
    }

    const result = await api.saveTxdTextures({
      txdPath: selectedModel.txd.fullPath,
      textures: nextTextures.map((texture) => ({
        name: texture.name,
        dataUrl: texture.dataUrl
      }))
    });

    if (result?.size !== undefined) {
      setFiles((currentFiles) =>
        currentFiles.map((file) => (
          file.fullPath === selectedModel.txd.fullPath
            ? { ...file, size: result.size, modifiedAt: result.modifiedAt ?? Date.now() }
            : file
        ))
      );
    }

    return result;
  }, [selectedModel?.txd?.fullPath]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', pendingAccentColor);
    document.documentElement.style.setProperty('--accent-rgb', hexToRgb(pendingAccentColor));
  }, [pendingAccentColor]);

  useEffect(() => {
    if (materials.length === 0) {
      setLogoOverlay((currentLogo) => (
        currentLogo.targetMaterialId || currentLogo.editedTextureDataUrl
          ? { ...currentLogo, targetMaterialId: '', editedTextureDataUrl: '', savedPath: '' }
          : currentLogo
      ));
      return;
    }

    const currentExists = materials.some((material) => material.id === logoOverlay.targetMaterialId);
    if (currentExists) {
      return;
    }

    const nextMaterial = materials.find((material) => material.previewDataUrl) ?? materials[0];
    setLogoOverlay((currentLogo) => ({
      ...currentLogo,
      targetMaterialId: nextMaterial.id,
      editedTextureDataUrl: '',
      savedPath: ''
    }));
  }, [materials, logoOverlay.targetMaterialId]);

  useEffect(() => {
    let canceled = false;

    async function composeTexture() {
      if (!logoOverlay.imageDataUrl || !logoTargetMaterial) {
        setLogoOverlay((currentLogo) => (
          currentLogo.editedTextureDataUrl
            ? { ...currentLogo, editedTextureDataUrl: '', savedPath: '' }
            : currentLogo
        ));
        setLogoComposeError('');
        return;
      }

      try {
        const composedTexture = await composeLogoTexture({
          baseDataUrl: logoTargetMaterial.originalPreviewDataUrl || logoTargetMaterial.previewDataUrl,
          logoDataUrl: logoOverlay.imageDataUrl,
          materialColor: logoTargetMaterial.color,
          opacity: logoOverlay.opacity,
          size: logoOverlay.size,
          x: logoOverlay.x,
          y: logoOverlay.y,
          rotation: logoOverlay.rotation
        });

        if (!canceled) {
          setLogoComposeError('');
          setLogoOverlay((currentLogo) => ({
            ...currentLogo,
            editedTextureDataUrl: composedTexture
          }));
        }
      } catch (error) {
        if (!canceled) {
          setLogoComposeError(error.message);
        }
      }
    }

    composeTexture();

    return () => {
      canceled = true;
    };
  }, [
    logoOverlay.imageDataUrl,
    logoOverlay.opacity,
    logoOverlay.rotation,
    logoOverlay.size,
    logoOverlay.x,
    logoOverlay.y,
    logoTargetMaterial
  ]);

  useEffect(() => {
    if (!logoOverlay.imageDataUrl || !logoOverlay.targetMaterialId || !logoOverlay.editedTextureDataUrl) {
      return undefined;
    }

    let canceled = false;
    const previousMaterialId = liveLogoMaterialRef.current;
    if (previousMaterialId && previousMaterialId !== logoOverlay.targetMaterialId) {
      viewportRef.current?.clearTextureOverride(previousMaterialId);
    }

    liveLogoMaterialRef.current = logoOverlay.targetMaterialId;
    viewportRef.current?.applyTextureOverride(logoOverlay.targetMaterialId, logoOverlay.editedTextureDataUrl)
      .then(() => {
        if (!canceled) {
          setLogoComposeError('');
        }
      })
      .catch((error) => {
        if (!canceled) {
          setLogoComposeError(error.message);
        }
      });

    return () => {
      canceled = true;
    };
  }, [logoOverlay.editedTextureDataUrl, logoOverlay.imageDataUrl, logoOverlay.targetMaterialId]);

  const applyScan = useCallback((scan, preferredId = null) => {
    if (!scan) {
      return;
    }

    const nextCatalog = buildCatalog(scan.files);
    const nextSelectedId =
      nextCatalog.models.find((model) => model.id === preferredId)?.id ?? nextCatalog.models[0]?.id ?? null;

    setFolderPath(scan.folderPath);
    setFiles(scan.files);
    setSelectedId(nextSelectedId);
    if (!scan.files.some((file) => file.fullPath === selectedIfpPath)) {
      setIfpData(null);
      setIfpSummary(null);
      setSelectedIfpPath('');
      setSelectedAnimationName('');
      setAnimationPlaying(false);
      setAnimationError('');
    }
    setStats(null);
    setMaterials([]);
    setTextures([]);
    setTextureEditStatus({ name: '', error: '' });
    setWarning('');
    setLoadState({ status: nextSelectedId ? 'idle' : 'empty', message: '' });
  }, [selectedIfpPath]);

  const openFolder = useCallback(async () => {
    if (!api?.openFolder) {
      setLoadState({ status: 'error', message: 'Ejecuta la app desde Electron para abrir carpetas.' });
      return;
    }

    try {
      setBusy(true);
      setLoadState({ status: 'loading', message: 'Esperando carpeta...' });
      const scan = await api.openFolder();
      if (!scan) {
        setLoadState({ status: 'idle', message: '' });
        return;
      }
      applyScan(scan, null);
    } catch (error) {
      setLoadState({ status: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }, [applyScan]);

  const rescanFolder = useCallback(async () => {
    if (!folderPath || !api?.rescanFolder) {
      return;
    }

    try {
      setBusy(true);
      setLoadState({ status: 'loading', message: 'Actualizando carpeta...' });
      const scan = await api.rescanFolder(folderPath);
      applyScan(scan, selectedId);
    } catch (error) {
      setLoadState({ status: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }, [applyScan, folderPath, selectedId]);

  const handleLoadStart = useCallback((model) => {
    setStats(null);
    setMaterials([]);
    setTextures([]);
    setTextureEditStatus({ name: '', error: '' });
    setWarning('');
    setLoadState({ status: 'loading', message: `Cargando ${model.displayName}` });
  }, []);

  const handleLoadDone = useCallback((result) => {
    if (!result) {
      setStats(null);
      setMaterials([]);
      setTextures([]);
      setTextureEditStatus({ name: '', error: '' });
      setWarning('');
      setLoadState({ status: 'idle', message: '' });
      return;
    }

    setStats(result.stats);
    setMaterials((result.materials ?? []).map((material) => ({
      ...material,
      originalPreviewDataUrl: material.originalPreviewDataUrl || material.previewDataUrl
    })));
    setTextures((result.textures ?? []).map((texture) => ({
      ...texture,
      originalDataUrl: texture.originalDataUrl || texture.dataUrl,
      originalWidth: texture.originalWidth || texture.width,
      originalHeight: texture.originalHeight || texture.height,
      replaced: false
    })));
    setTextureEditStatus({ name: '', error: '' });
    setWarning(result.warning ?? '');
    setLoadState({ status: 'ready', message: '' });
  }, []);

  const handleLoadError = useCallback((error) => {
    setStats(null);
    setMaterials([]);
    setTextures([]);
    setTextureEditStatus({ name: '', error: '' });
    setWarning('');
    setLoadState({ status: 'error', message: error.message });
  }, []);

  const handleAnimationStatus = useCallback((state) => {
    setAnimationError(state?.error ?? '');
    if (state?.error) {
      setAnimationPlaying(false);
    }
  }, []);

  const toggleMaterial = useCallback((materialId) => {
    setMaterials((currentMaterials) =>
      currentMaterials.map((material) => {
        if (material.id !== materialId) {
          return material;
        }

        const visible = !material.visible;
        viewportRef.current?.setMaterialVisible(materialId, visible);
        return { ...material, visible };
      })
    );
  }, []);

  const showAllMaterials = useCallback(() => {
    viewportRef.current?.setAllMaterialsVisible(true);
    setMaterials((currentMaterials) => currentMaterials.map((material) => ({ ...material, visible: true })));
  }, []);

  const toggleFavorite = useCallback(async (model) => {
    if (!model?.dff?.fullPath) {
      return;
    }

    const key = model.dff.fullPath;
    if (favoriteByPath[key]) {
      updateFavorites((currentFavorites) => {
        const nextFavorites = { ...currentFavorites };
        delete nextFavorites[key];
        return nextFavorites;
      });
      return;
    }

    try {
      const copied = await api?.addFavoriteSkin?.({
        dffPath: model.dff.fullPath,
        txdPath: model.txd?.fullPath || '',
        displayName: model.displayName
      });

      updateFavorites((currentFavorites) => ({
        ...currentFavorites,
        [key]: {
          displayName: model.displayName,
          dffPath: model.dff.fullPath,
          txdPath: model.txd?.fullPath || '',
          favoriteFolder: copied?.folderPath || '',
          addedAt: Date.now()
        }
      }));

      if (copied?.folderPath) {
        pushNotification({
          type: 'success',
          title: 'Favorita copiada',
          message: compactPath(copied.folderPath)
        });
      }
    } catch (error) {
      pushNotification({
        type: 'error',
        title: 'No se pudo copiar a favorites',
        message: error.message
      });
    }
  }, [favoriteByPath, pushNotification, updateFavorites]);

  const replaceTextureImage = useCallback(async (texture, file) => {
    if (!texture || !file) {
      return;
    }

    try {
      setTextureEditStatus({ name: texture.name, error: '' });
      const image = await readImageFile(file);
      const applied = await viewportRef.current?.replaceTextureByName(texture.name, image.dataUrl);

      if (!applied) {
        throw new Error(`No se encontro ningun material usando ${texture.name}.`);
      }

      setTextures((currentTextures) =>
        currentTextures.map((currentTexture) => (
          textureNameKey(currentTexture.name) === textureNameKey(texture.name)
            ? {
              ...currentTexture,
              dataUrl: image.dataUrl,
              width: image.width,
              height: image.height,
              sourceFileName: image.name,
              originalDataUrl: currentTexture.originalDataUrl || currentTexture.dataUrl,
              originalWidth: currentTexture.originalWidth || currentTexture.width,
              originalHeight: currentTexture.originalHeight || currentTexture.height,
              replaced: true
            }
            : currentTexture
        ))
      );

      setMaterials((currentMaterials) =>
        currentMaterials.map((material) => (
          materialUsesTexture(material, texture.name)
            ? {
              ...material,
              previewDataUrl: image.dataUrl,
              originalPreviewDataUrl: material.originalPreviewDataUrl || material.previewDataUrl,
              textureReplaced: true
            }
            : material
        ))
      );

      setTextureEditStatus({ name: '', error: '' });
    } catch (error) {
      setTextureEditStatus({ name: '', error: error.message });
    }
  }, []);

  const revertTextureImage = useCallback((texture) => {
    if (!texture) {
      return;
    }

    try {
      const reverted = viewportRef.current?.revertTextureByName(texture.name);
      if (!reverted) {
        throw new Error(`No habia reemplazo activo para ${texture.name}.`);
      }

      setTextures((currentTextures) =>
        currentTextures.map((currentTexture) => (
          textureNameKey(currentTexture.name) === textureNameKey(texture.name)
            ? {
              ...currentTexture,
              dataUrl: currentTexture.originalDataUrl || currentTexture.dataUrl,
              width: currentTexture.originalWidth || currentTexture.width,
              height: currentTexture.originalHeight || currentTexture.height,
              sourceFileName: '',
              replaced: false
            }
            : currentTexture
        ))
      );

      setMaterials((currentMaterials) =>
        currentMaterials.map((material) => (
          materialUsesTexture(material, texture.name)
            ? {
              ...material,
              previewDataUrl: material.originalPreviewDataUrl || material.previewDataUrl,
              textureReplaced: false
            }
            : material
        ))
      );

      setTextureEditStatus({ name: '', error: '' });
    } catch (error) {
      setTextureEditStatus({ name: '', error: error.message });
    }
  }, []);

  const saveTextureChanges = useCallback(async () => {
    const changedTextures = textures.filter((texture) => texture.replaced);

    if (!selectedModel?.txd) {
      pushNotification({
        type: 'error',
        title: 'No hay TXD para guardar',
        message: 'Esta skin no tiene un TXD asociado.'
      });
      return;
    }

    if (changedTextures.length === 0) {
      pushNotification({
        type: 'info',
        title: 'Sin cambios pendientes',
        message: 'Cambia una textura antes de guardar el TXD.'
      });
      return;
    }

    try {
      setTextureSaving(true);
      setTextureEditStatus({ name: '', error: '' });
      const result = await writeTexturesToTxd(textures);
      const changedKeys = new Set(changedTextures.map((texture) => textureNameKey(texture.name)));

      setTextures((currentTextures) =>
        currentTextures.map((texture) => (
          changedKeys.has(textureNameKey(texture.name))
            ? {
              ...texture,
              originalDataUrl: texture.dataUrl,
              originalWidth: texture.width,
              originalHeight: texture.height,
              sourceFileName: '',
              replaced: false
            }
            : texture
        ))
      );

      setMaterials((currentMaterials) =>
        currentMaterials.map((material) => (
          changedTextures.some((texture) => materialUsesTexture(material, texture.name))
            ? {
              ...material,
              originalPreviewDataUrl: material.previewDataUrl,
              textureReplaced: false
            }
            : material
        ))
      );

      pushNotification({
        type: 'success',
        title: 'TXD actualizado',
        message: result?.backupPath ? `Backup: ${compactPath(result.backupPath)}` : 'Texturas guardadas dentro del TXD.'
      });
    } catch (error) {
      setTextureEditStatus({ name: '', error: error.message });
      pushNotification({
        type: 'error',
        title: 'No se pudo guardar el TXD',
        message: error.message
      });
    } finally {
      setTextureSaving(false);
    }
  }, [pushNotification, selectedModel?.txd, textures, writeTexturesToTxd]);

  const selectIfp = useCallback(async (ifpPath) => {
    setSelectedIfpPath(ifpPath);
    setAnimationError('');
    setAnimationPlaying(false);

    if (!ifpPath) {
      setIfpData(null);
      setIfpSummary(null);
      setSelectedAnimationName('');
      return;
    }

    try {
      const buffer = await api.readBinaryFile(ifpPath);
      const parsed = parseIfp(buffer);
      const summary = getIfpSummary(parsed);
      setIfpData(parsed);
      setIfpSummary(summary);
      setSelectedAnimationName(summary.animations[0]?.name ?? '');
    } catch (error) {
      setIfpData(null);
      setIfpSummary(null);
      setSelectedAnimationName('');
      setAnimationError(error.message);
    }
  }, []);

  const changeTransformMode = useCallback((mode) => {
    setTransformMode(mode);
    setTransformEnabled(true);
    viewportRef.current?.setTransformMode(mode);
    viewportRef.current?.setTransformEnabled(true);
  }, []);

  const toggleTransform = useCallback(() => {
    setTransformEnabled((enabled) => {
      const nextEnabled = !enabled;
      viewportRef.current?.setTransformEnabled(nextEnabled);
      return nextEnabled;
    });
  }, []);

  const loadLogo = useCallback((logo) => {
    setLogoOverlay((currentLogo) => ({
      ...defaultLogoOverlay,
      targetMaterialId: currentLogo.targetMaterialId || materials.find((material) => material.previewDataUrl)?.id || materials[0]?.id || '',
      ...logo
    }));
  }, [materials]);

  const changeLogo = useCallback((changes) => {
    const shouldClearSaveState = Object.keys(changes).some((key) => !['savedPath', 'txdSavedPath', 'txdBackupPath'].includes(key));
    setLogoOverlay((currentLogo) => ({
      ...currentLogo,
      ...(shouldClearSaveState ? { savedPath: '', txdSavedPath: '', txdBackupPath: '' } : null),
      ...changes
    }));
  }, []);

  const clearLogo = useCallback(() => {
    const materialId = liveLogoMaterialRef.current || logoOverlay.targetMaterialId;
    if (materialId) {
      viewportRef.current?.clearTextureOverride(materialId);
    }
    liveLogoMaterialRef.current = '';
    setLogoOverlay(defaultLogoOverlay);
    setLogoComposeError('');
    setMaterials((currentMaterials) =>
      currentMaterials.map((material) => ({
        ...material,
        previewDataUrl: material.id === materialId ? material.originalPreviewDataUrl || material.previewDataUrl : material.previewDataUrl,
        logoApplied: material.id === materialId ? false : material.logoApplied
      }))
    );
  }, [logoOverlay.targetMaterialId]);

  const applyLogoToMaterial = useCallback(async () => {
    if (!logoOverlay.targetMaterialId || !logoOverlay.editedTextureDataUrl) {
      return;
    }

    try {
      await viewportRef.current?.applyTextureOverride(logoOverlay.targetMaterialId, logoOverlay.editedTextureDataUrl);
      liveLogoMaterialRef.current = logoOverlay.targetMaterialId;
      setMaterials((currentMaterials) =>
        currentMaterials.map((material) => (
          material.id === logoOverlay.targetMaterialId
            ? { ...material, previewDataUrl: logoOverlay.editedTextureDataUrl, logoApplied: true }
            : material
        ))
      );
      setLogoComposeError('');
    } catch (error) {
      setLogoComposeError(error.message);
    }
  }, [logoOverlay.editedTextureDataUrl, logoOverlay.targetMaterialId]);

  const saveLogoTexture = useCallback(async () => {
    if (!logoOverlay.editedTextureDataUrl || !api?.savePng) {
      setLogoComposeError('El guardado solo esta disponible dentro de Electron.');
      return;
    }

    try {
      setLogoSaving(true);
      await applyLogoToMaterial();
      const materialName = (logoTargetMaterial?.displayName || 'textura').replace(/[^a-z0-9_-]+/gi, '_');
      const savedPath = await api.savePng({
        dataUrl: logoOverlay.editedTextureDataUrl,
        suggestedName: `${materialName}_logo.png`
      });
      let txdResult = null;

      if (selectedModel?.txd) {
        let textureWasUpdated = false;
        const nextTextures = textures.map((texture) => {
          if (!logoTargetMaterial || !materialUsesTexture(logoTargetMaterial, texture.name)) {
            return texture;
          }

          textureWasUpdated = true;
          return {
            ...texture,
            dataUrl: logoOverlay.editedTextureDataUrl,
            replaced: true,
            sourceFileName: logoOverlay.name || 'logo'
          };
        });

        if (!textureWasUpdated) {
          throw new Error('No se encontro en el TXD la textura del material seleccionado.');
        }

        txdResult = await writeTexturesToTxd(nextTextures);
        setTextures(nextTextures.map((texture) => (
          materialUsesTexture(logoTargetMaterial, texture.name)
            ? {
              ...texture,
              originalDataUrl: texture.dataUrl,
              originalWidth: texture.width,
              originalHeight: texture.height,
              sourceFileName: '',
              replaced: false
            }
            : texture
        )));
        setMaterials((currentMaterials) =>
          currentMaterials.map((material) => (
            material.id === logoOverlay.targetMaterialId
              ? {
                ...material,
                previewDataUrl: logoOverlay.editedTextureDataUrl,
                originalPreviewDataUrl: logoOverlay.editedTextureDataUrl,
                logoApplied: false
              }
              : material
          ))
        );
      }

      setLogoOverlay((currentLogo) => ({
        ...currentLogo,
        savedPath: savedPath || currentLogo.savedPath,
        txdSavedPath: txdResult?.txdPath || currentLogo.txdSavedPath,
        txdBackupPath: txdResult?.backupPath || currentLogo.txdBackupPath
      }));
      setLogoComposeError('');
      if (txdResult?.backupPath) {
        pushNotification({
          type: 'success',
          title: 'TXD actualizado',
          message: `Backup: ${compactPath(txdResult.backupPath)}`
        });
      }
    } catch (error) {
      setLogoComposeError(error.message);
      pushNotification({
        type: 'error',
        title: 'No se pudo guardar el logo',
        message: error.message
      });
    } finally {
      setLogoSaving(false);
    }
  }, [
    applyLogoToMaterial,
    logoOverlay.editedTextureDataUrl,
    logoOverlay.name,
    logoOverlay.targetMaterialId,
    logoTargetMaterial,
    pushNotification,
    selectedModel,
    textures,
    writeTexturesToTxd
  ]);

  const changePendingAccent = useCallback((color) => {
    setPendingAccentColor(color);
    setColorSaved(color === accentColor);
  }, [accentColor]);

  const saveAccent = useCallback(() => {
    window.localStorage.setItem('skinViewerAccentColor', pendingAccentColor);
    setAccentColor(pendingAccentColor);
    setColorSaved(true);
  }, [pendingAccentColor]);

  return (
    <div className="app-shell">
      <TopToolbar
        selectedModel={selectedModel}
        folderPath={folderPath}
        busy={busy}
        wireframe={wireframe}
        onOpenFolder={openFolder}
        onRescan={rescanFolder}
        onResetCamera={() => viewportRef.current?.resetCamera()}
        onFitView={() => viewportRef.current?.fitView()}
        onToggleWireframe={() => setWireframe((value) => !value)}
        onOpenHelp={() => setShowHelp(true)}
      />

      <main className="workspace">
        <FileSidebar
          folderPath={folderPath}
          catalog={catalog}
          models={filteredModels}
          favoriteModels={favoriteModels}
          favoriteByPath={favoriteByPath}
          selectedId={selectedId}
          query={query}
          busy={busy}
          onQueryChange={setQuery}
          onOpenFolder={openFolder}
          onToggleFavorite={toggleFavorite}
          onSelect={setSelectedId}
        />

        <section className="viewer-panel" data-load-state={loadState.status} data-model-loaded={stats ? 'true' : 'false'}>
          <DffViewportViewer
            ref={viewportRef}
            selectedModel={selectedModel}
            wireframe={wireframe}
            showBones={showBones}
            transformEnabled={transformEnabled}
            transformMode={transformMode}
            activeAnimation={activeAnimation}
            animationPlaying={animationPlaying}
            animationLoop={animationLoop}
            animationSpeed={animationSpeed}
            onLoadStart={handleLoadStart}
            onLoadDone={handleLoadDone}
            onLoadError={handleLoadError}
            onAnimationStatus={handleAnimationStatus}
          />
          <ViewportOverlay selectedModel={selectedModel} loadState={loadState} />
        </section>

        <Inspector
          selectedModel={selectedModel}
          stats={stats}
          warning={warning}
          loadState={loadState}
          transformEnabled={transformEnabled}
          transformMode={transformMode}
          showBones={showBones}
          logoOverlay={logoOverlay}
          logoComposeError={logoComposeError}
          logoSaving={logoSaving}
          pendingAccentColor={pendingAccentColor}
          colorSaved={colorSaved}
          materials={materials}
          textures={textures}
          textureEditStatus={textureEditStatus}
          textureSaving={textureSaving}
          canSaveTextures={canSaveTextures}
          ifpFiles={catalog.ifpFiles}
          selectedIfpPath={selectedIfpPath}
          ifpSummary={ifpSummary}
          selectedAnimationName={selectedAnimationName}
          animationPlaying={animationPlaying}
          animationLoop={animationLoop}
          animationSpeed={animationSpeed}
          animationError={animationError}
          onToggleMaterial={toggleMaterial}
          onShowAllMaterials={showAllMaterials}
          onReplaceTexture={replaceTextureImage}
          onRevertTexture={revertTextureImage}
          onSaveTextures={saveTextureChanges}
          onSelectIfp={selectIfp}
          onSelectAnimation={(animationName) => {
            setSelectedAnimationName(animationName);
            setAnimationPlaying(false);
          }}
          onToggleAnimationPlaying={() => setAnimationPlaying((playing) => !playing)}
          onToggleAnimationLoop={() => setAnimationLoop((loop) => !loop)}
          onAnimationSpeedChange={setAnimationSpeed}
          onToggleTransform={toggleTransform}
          onTransformModeChange={changeTransformMode}
          onToggleBones={() => setShowBones((visible) => !visible)}
          onStraighten={() => viewportRef.current?.straightenModel()}
          onResetTransform={() => viewportRef.current?.resetModelTransform()}
          onLoadLogo={loadLogo}
          onLogoChange={changeLogo}
          onApplyLogo={applyLogoToMaterial}
          onSaveLogo={saveLogoTexture}
          onClearLogo={clearLogo}
          onPendingAccentChange={changePendingAccent}
          onSaveAccent={saveAccent}
        />
      </main>
      <ToastStack notifications={notifications} onDismiss={dismissNotification} />
      <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
