# Skin Viewer

Visualizador y editor ligero para skins RenderWare de GTA/SAMP. Permite abrir una carpeta con archivos `.dff` y `.txd`, ver el modelo en 3D, inspeccionar materiales/texturas, reemplazar texturas del TXD y guardar una copia actualizada con backup automático.

## Funciones

- Carga modelos `.dff` con texturas `.txd` emparejadas por nombre.
- Cámara orbital con mouse, zoom con rueda y encuadre/reset desde la barra superior.
- Inspector con peso de DFF/TXD, geometría, materiales, texturas e IFP disponibles.
- Mostrar/ocultar materiales.
- Reemplazar texturas desde PNG/JPG y guardar el TXD actualizado.
- Editor de logo sobre material con preview en tiempo real.
- Favoritos que copian DFF/TXD a una carpeta `favorites`.
- Notificaciones internas para acciones de guardado, backups y errores.
- Auto-update desde GitHub Releases para la versión instalable NSIS.

## Requisitos

- Node.js 20 o superior.
- Windows para buildear el instalador `.exe`.
- GitHub CLI (`gh`) solo si vas a publicar releases desde tu PC.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build

Build web:

```bash
npm run build
```

Build Windows completo:

```bash
npm run dist:win
```

Esto genera dos artefactos en `release/`:

- `Skin-Viewer-by-Tokyo-tears-Setup-<version>-x64.exe`: instalador con auto-update.
- `Skin-Viewer-by-Tokyo-tears-Portable-<version>-x64.exe`: portable sin auto-update.

## Auto-update desde GitHub

El auto-update usa `electron-updater` + GitHub Releases. En Windows, electron-updater soporta actualizaciones automáticas con target NSIS. Por eso el auto-update funciona con el instalador `Setup`, no con el portable.

El repo configurado para updates es:

```txt
Tokyotears6642/dff-skin-viewer
```

Para publicar una release desde local:

```bash
set GH_TOKEN=tu_token_de_github
npm run dist:win:publish
```

En GitHub Actions, el workflow `.github/workflows/release.yml` publica cuando se sube un tag `v*`.

Ejemplo:

```bash
npm version patch
git push
git push --tags
```

## Guardado de texturas

Cuando reemplazas una textura y presionas `Guardar TXD`, la app:

1. Genera un backup del `.txd` original junto al archivo.
2. Reescribe el `.txd` con las texturas actuales.
3. Actualiza el peso del TXD en el inspector.
4. Muestra una notificación con la ruta del backup.

Haz copia de tus skins antes de editar si son archivos importantes.

## Estructura principal

```txt
electron/            Proceso principal y preload de Electron
src/                 UI React y viewer Three.js
src/components/      Viewport 3D
src/lib/             Parsers/helpers de texturas, IFP y formato
public/              Assets públicos del renderer
logo.png             Logo usado por la app
icon.ico             Icono Windows del ejecutable
```

## Scripts

- `npm run dev`: Vite + Electron en desarrollo.
- `npm run lint`: ESLint.
- `npm run build`: build web de Vite.
- `npm run dist:win`: build Windows completo, Setup + Portable.
- `npm run dist:win:portable`: solo portable.
- `npm run dist:win:publish`: build y publicación en GitHub Releases.
